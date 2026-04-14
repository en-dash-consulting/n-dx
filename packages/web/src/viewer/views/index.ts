/**
 * Public barrel for the viewer views directory.
 *
 * Tests and sibling zones should import through this barrel rather than
 * reaching into leaf files directly — converts white-box leaf imports to
 * stable barrel imports that survive internal view reorganization.
 *
 * Rules:
 *   - Re-export only — no logic in this file
 *   - Add a re-export here before importing any views/ module from outside
 *     this directory
 */

export { ENRICHMENT_THRESHOLDS } from "./enrichment-thresholds.js";
export type { SourceVisionTab, SourceVisionTabId } from "./sourcevision-tabs.js";
export { SOURCEVISION_TABS, SOURCEVISION_TAB_IDS } from "./sourcevision-tabs.js";
