/**
 * Feature toggle contract types — shared between server and viewer.
 *
 * These interfaces define the API shape for GET/PUT /api/features.
 * Both the server (routes-features.ts) and viewer (feature-toggles.ts)
 * import from here, preventing silent type drift when a field changes.
 */

export interface FeatureToggle {
  /** Dot-notation key (e.g., "sourcevision.showCallGraph"). */
  key: string;
  /** Human-readable label. */
  label: string;
  /** Description of what the feature does. */
  description: string;
  /** Impact warning — shown to explain consequences. */
  impact: string;
  /** Which package owns this toggle. */
  package: "sourcevision" | "rex" | "hench";
  /** Whether this is experimental, stable, or deprecated. */
  stability: "experimental" | "stable" | "deprecated";
  /** Current value (true = enabled). */
  enabled: boolean;
  /** Default value if not set in config. */
  defaultValue: boolean;
}

export interface FeaturesResponse {
  toggles: FeatureToggle[];
}
