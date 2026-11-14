/**
 * The sections of Settings › Project, in page order: settings grouped by what
 * they change, not by the package that owns them. A feature toggle's registry
 * `group` names its section, so every group must be listed here
 * (`feature-toggle-rendering.test.ts` holds the page to that).
 */

import type { FeatureToggle } from "../external.js";

export type ProjectSectionId = "analysis" | "dashboard" | FeatureToggle["group"];

export const PROJECT_SECTIONS: ReadonlyArray<{ id: ProjectSectionId; title: string }> = [
  { id: "analysis", title: "Analysis" },
  { id: "dashboard", title: "Dashboard" },
  { id: "git", title: "Git and commits" },
  { id: "display", title: "Display" },
  { id: "optional", title: "Optional features" },
  { id: "connections", title: "Connections" },
];
