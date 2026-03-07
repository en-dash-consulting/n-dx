/**
 * Enrichment pass thresholds for sourcevision views.
 *
 * Defines the minimum enrichment pass required before each view unlocks.
 * This is sourcevision-domain configuration, not a UI infrastructure primitive.
 */
export const ENRICHMENT_THRESHOLDS = {
  architecture: 2,
  problems: 3,
  suggestions: 4,
} as const;
