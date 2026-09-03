/**
 * SourceVision tab configuration — domain-specific view tab definitions.
 *
 * Defines the tab IDs, labels, icons, and minimum enrichment pass required
 * for each SourceVision view. This is sourcevision domain config, not a
 * generic infrastructure primitive.
 */
import type { SourcevisionScopeViewId } from "../external.js";
import { ENRICHMENT_THRESHOLDS } from "./enrichment-thresholds.js";

export type SourceVisionTabId = SourcevisionScopeViewId;

export interface SourceVisionTab {
  id: SourceVisionTabId;
  icon: string;
  label: string;
  minPass: number;
  featureGate?: string;
  /**
   * When true, hide this tab in deployed (static export) mode.
   *
   * Set for views whose content is built on demand by the server and therefore
   * cannot exist in an `ndx export` bundle. The view itself still renders an
   * explanatory card if reached by direct URL.
   */
  requiresServer?: boolean;
}

export const SOURCEVISION_TABS: readonly SourceVisionTab[] = [
  { id: "overview", icon: "\u25A3", label: "Overview", minPass: 0 },
  { id: "graph", icon: "\u25A7", label: "Map", minPass: 0 },
  { id: "iso-map", icon: "\u25E7", label: "Isometric Map", minPass: 0, requiresServer: true },
  { id: "zones", icon: "\u2B22", label: "Zones", minPass: 0 },
  { id: "files", icon: "\u2630", label: "Files", minPass: 0 },
  { id: "routes", icon: "\u25C7", label: "Routes", minPass: 0 },
  { id: "architecture", icon: "\u25E8", label: "Architecture", minPass: ENRICHMENT_THRESHOLDS.architecture },
  { id: "problems", icon: "\u26A0", label: "Problems", minPass: ENRICHMENT_THRESHOLDS.problems },
  { id: "suggestions", icon: "\u2728", label: "Suggestions", minPass: ENRICHMENT_THRESHOLDS.suggestions },
  { id: "pr-markdown", icon: "\u270D", label: "PR Markdown", minPass: 0, featureGate: "sourcevision.prMarkdown" },
  // TODO(ask-panel): the gated "Ask" tab lands here -- a prompt/response text
  // exchange over the analysed project (explain a finding, refine the PRD).
  // Tracked by PRD feature d339458a "SourceVision Ask Panel".
  //
  // Once it works here, the same panel is wanted on the Rex and Hench surfaces.
  // That is deliberately not tracked in the PRD yet: generalise this one first,
  // then lift the shared piece out. Adoption markers for the other two domains
  // are in domain-rex.ts and domain-hench.ts.
];

export const SOURCEVISION_TAB_IDS: SourceVisionTabId[] = SOURCEVISION_TABS.map((tab) => tab.id);
