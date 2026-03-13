/**
 * SourceVision tab configuration — domain-specific view tab definitions.
 *
 * Defines the tab IDs, labels, icons, and minimum enrichment pass required
 * for each SourceVision view. This is sourcevision domain config, not a
 * generic infrastructure primitive.
 */
import type { ViewId } from "../types.js";
import { ENRICHMENT_THRESHOLDS } from "./enrichment-thresholds.js";

export type SourceVisionTabId = Extract<
  ViewId,
  "overview" | "graph" | "zones" | "files" | "routes" | "architecture" | "problems" | "suggestions" | "pr-markdown"
>;

export interface SourceVisionTab {
  id: SourceVisionTabId;
  icon: string;
  label: string;
  minPass: number;
  featureGate?: string;
}

export const SOURCEVISION_TABS: readonly SourceVisionTab[] = [
  { id: "overview", icon: "\u25A3", label: "Overview", minPass: 0 },
  { id: "graph", icon: "\u2B95", label: "Import Graph", minPass: 0, featureGate: "sourcevision.callGraph" },
  { id: "zones", icon: "\u2B22", label: "Zones", minPass: 0 },
  { id: "files", icon: "\u2630", label: "Files", minPass: 0 },
  { id: "routes", icon: "\u25C7", label: "Routes", minPass: 0 },
  { id: "architecture", icon: "\u25E8", label: "Architecture", minPass: ENRICHMENT_THRESHOLDS.architecture },
  { id: "problems", icon: "\u26A0", label: "Problems", minPass: ENRICHMENT_THRESHOLDS.problems },
  { id: "suggestions", icon: "\u2728", label: "Suggestions", minPass: ENRICHMENT_THRESHOLDS.suggestions },
  { id: "pr-markdown", icon: "\u270D", label: "PR Markdown", minPass: 0 },
];

export const SOURCEVISION_TAB_IDS: SourceVisionTabId[] = SOURCEVISION_TABS.map((tab) => tab.id);
