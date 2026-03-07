/**
 * Infrastructure design tokens — generic primitives shared across all views.
 *
 * Domain-specific constants (e.g. enrichment thresholds) live in their
 * respective domain directories (see views/enrichment-thresholds.ts).
 *
 * ZONE_COLORS is now owned by visualization/colors.ts and re-exported
 * here for backward compatibility.
 */
export { ZONE_COLORS } from "../visualization/colors.js";
