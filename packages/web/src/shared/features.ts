/**
 * Feature toggle contract types — shared between server and viewer.
 *
 * These interfaces define the API shape for GET/PUT /api/features.
 * Both the server (routes-features.ts) and viewer (feature-toggles.ts)
 * import from here, preventing silent type drift when a field changes.
 *
 * Placed in shared/ because this is a framework-agnostic contract with
 * two distinct consumer zones (web-server and web-viewer), consistent
 * with the web-shared foundation layer governance rules.
 */

/**
 * Where Settings › Project shows a toggle: by what it changes, not by the
 * package that owns it. Every registry entry names one, so a new toggle cannot
 * be left off the page.
 */
export type FeatureGroup = "git" | "display" | "optional" | "connections";

export interface FeatureToggle {
  /** Dot-notation key (e.g., "sourcevision.showCallGraph"). */
  key: string;
  /** Human-readable label. */
  label: string;
  /** Description of what the feature does. */
  description: string;
  /** Impact warning — shown to explain consequences. */
  impact: string;
  /**
   * Longer explanation, revealed by an info control on the toggle. Present
   * only where the one-line description genuinely is not enough — a toggle
   * that changes behaviour outside the dashboard, say.
   */
  details?: string;
  /** Which package owns this toggle. */
  package: "sourcevision" | "rex" | "hench" | "git" | "web";
  /** The Project settings section that shows it. */
  group: FeatureGroup;
  /** True when turning it on lets the dashboard spend tokens (each use is an LLM call). */
  costsTokens?: boolean;
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
