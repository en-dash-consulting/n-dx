/**
 * The shapes a change's placement is edited in: a node it can be placed on,
 * and a target criterion as the Amends form holds it.
 *
 * Types only, so placement-draft.ts can keep a draft of them without
 * importing change-placement.ts, which reads the Inbox that prunes those
 * drafts; change-placement.ts re-exports both.
 *
 * @module viewer/components/prd-tree/placement-types
 */

import type { PlacementStrength } from "../../views/product-model.js";

/** A node a change can be placed on: a shortlist candidate, or a search pick. */
export interface PlacementTarget {
  target: string;
  /** Absent on a Quick Add preview candidate whose node the server could not read. */
  type?: "capability" | "constraint";
  title: string;
  area: string;
  statement?: string;
  /** Absent when not read yet (a search pick; read on choosing Amends). */
  criteria?: Array<{ id: string; text: string }>;
  strength?: PlacementStrength;
  reasons?: string[];
}

/** A target criterion as the Amends form holds it while it is edited. */
export interface CriterionDraft {
  id: string;
  text: string;
  /** The target's text; absent on a criterion this amendment adds. */
  original?: string;
  removed?: boolean;
}
