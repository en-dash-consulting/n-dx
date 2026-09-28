/**
 * The dashboard's layout, as data.
 *
 * Three stages in a loop — Analysis → Plan → Work → Analysis — each a page
 * that composes existing product views as collapsible sections. Every view
 * keeps its own route (`/zones`, `/hench-runs/<id>`, …); a section is a
 * window onto it with an "Open" link to the full page. Settings views are not
 * part of any stage: they open as a full overlay from the bottom bar's cog.
 *
 * This file is the one place the arrangement lives. The top navigation, the
 * stage pages, the side stage links, the breadcrumb and the landing page all
 * read it, so moving a view between stages is an edit here and nowhere else.
 *
 * Pure data and pure functions — no Preact — so both components and views
 * can import it (components through api.ts).
 */

import type { ViewId } from "../types.js";

export type StageId = "analyze" | "plan" | "work";

export type StageProduct = "sourcevision" | "rex" | "hench";

export interface StageSection {
  /** View rendered in the section and opened full-page by its "Open" link. */
  view: ViewId;
  title: string;
  /** One line under the title saying what the section is for. */
  blurb: string;
  /** Expanded when the stage page first opens. */
  open?: boolean;
  /**
   * A second projection of the same content behind a toggle in the section
   * header — the 2D import map and the 3D isometric map are one section.
   */
  alt?: { view: ViewId; label: string; primaryLabel: string };
  /**
   * The view owns a full-height layout of its own (the Tasks tree) and is
   * offered as a link rather than embedded.
   */
  linkOnly?: boolean;
  /** Hidden when this feature toggle is off (same keys as `useFeatureToggle`). */
  featureGate?: string;
  /** Built on demand by the server — absent from a static export. */
  requiresServer?: boolean;
}

export interface StageDef {
  id: StageId;
  label: string;
  glyph: string;
  product: StageProduct;
  /** One sentence for the landing page and the stage page header. */
  blurb: string;
  sections: readonly StageSection[];
}

/** Loop order. The side stage links step through it and wrap. */
export const STAGE_ORDER: readonly StageId[] = ["analyze", "plan", "work"];

export const STAGES: Readonly<Record<StageId, StageDef>> = {
  analyze: {
    id: "analyze",
    label: "Analysis",
    glyph: "▣",
    product: "sourcevision",
    blurb: "What the codebase looks like: files, zones, imports and the findings worth acting on.",
    sections: [
      { view: "overview", title: "General repository information", blurb: "Counts, health and coupling, the largest zones.", open: true },
      {
        view: "graph",
        title: "Repository map",
        blurb: "The import graph, drawn flat or as an isometric block map.",
        alt: { view: "iso-map", label: "3D", primaryLabel: "2D" },
      },
      { view: "zones", title: "Zones", blurb: "Clusters of files that import each other more than the rest." },
      { view: "files", title: "Files", blurb: "The inventory, by role and language." },
      { view: "problems", title: "Problems", blurb: "Findings from the enrichment passes." },
      { view: "suggestions", title: "Suggestions", blurb: "Improvements the analysis proposes." },
      { view: "architecture", title: "Architecture", blurb: "Patterns and layering across zones." },
      { view: "routes", title: "Routes", blurb: "Pages, API routes and layouts." },
      { view: "pr-markdown", title: "PR Markdown", blurb: "The analysis as a pull-request summary.", featureGate: "sourcevision.prMarkdown" },
      { view: "ask", title: "Ask", blurb: "Question the analysis in plain language.", featureGate: "sourcevision.ask", requiresServer: true },
      { view: "token-usage", title: "Token usage", blurb: "What analysis, planning and runs have spent." },
    ],
  },
  plan: {
    id: "plan",
    label: "Plan",
    glyph: "☑",
    product: "rex",
    blurb: "What to build next: the PRD, proposals from analysis, and the planning commands.",
    sections: [
      { view: "analysis", title: "Add items", blurb: "Describe work, import a document, or turn analysis into proposals.", open: true },
      { view: "prd", title: "Tasks", blurb: "The full PRD tree — epics, features, tasks.", linkOnly: true },
      { view: "command-reference", title: "CLI help", blurb: "Every command, with the ones you can run from here." },
      { view: "hench-runs", title: "History", blurb: "What the agent has run, most recent first." },
      { view: "merge-graph", title: "Context graph", blurb: "How the PRD's items connect." },
      { view: "validation", title: "Validation", blurb: "Structural checks on the PRD." },
      { view: "requirements", title: "Requirements", blurb: "Acceptance criteria and where they are tested." },
    ],
  },
  work: {
    id: "work",
    label: "Work",
    glyph: "▶",
    product: "hench",
    blurb: "Get it done: hand the next task to the agent, pick a run mode, watch what it costs.",
    sections: [
      { view: "rex-dashboard", title: "Up next and PRD items", blurb: "The next task with its run button, progress and open epics.", open: true },
      { view: "activity", title: "History", blurb: "The execution log — completions as the agent recorded them." },
      { view: "hench-templates", title: "Templates", blurb: "Run presets: limits, guard rails, provider." },
      { view: "token-usage", title: "Usage", blurb: "Tokens and estimated cost by period and package." },
      { view: "hench-audit", title: "Audit", blurb: "Per-task run logs and outcomes." },
      { view: "hench-optimization", title: "Optimization", blurb: "Where runs spend their turns." },
      { view: "hench-adaptive", title: "Adaptive", blurb: "Settings the runs have tuned themselves." },
      { view: "workspaces", title: "Workspaces", blurb: "Every worktree of this repository and what each is running.", requiresServer: true },
    ],
  },
};

// ── Settings ───────────────────────────────────────────────────

export interface SettingsEntry {
  view: ViewId;
  /** May contain the `{cli}` placeholder, resolved by the caller. */
  label: string;
  glyph: string;
  featureGate?: string;
}

/** Workflow order: General → analyze/plan → work → sync → export, then cross-cutting. */
export const SETTINGS_ENTRIES: readonly SettingsEntry[] = [
  { view: "llm-provider", label: "General", glyph: "\u{1F9E0}" },
  { view: "project-settings", label: "{cli} analyze / plan", glyph: "▣" },
  { view: "hench-config", label: "{cli} work", glyph: "▶" },
  { view: "notion-config", label: "{cli} sync", glyph: "\u{1F50C}", featureGate: "rex.notionSync" },
  { view: "integrations", label: "Integrations", glyph: "\u{1F517}", featureGate: "rex.integrations" },
  { view: "commands", label: "{cli} export / refresh", glyph: "\u{1F4E4}" },
  { view: "feature-toggles", label: "Feature Flags", glyph: "\u{1F4CC}" },
  { view: "cli-timeouts", label: "CLI Timeouts", glyph: "⏱" },
];

const SETTINGS_VIEWS: ReadonlySet<ViewId> = new Set(SETTINGS_ENTRIES.map((e) => e.view));

/** True for views that open in the settings overlay rather than the page. */
export function isSettingsView(view: ViewId): boolean {
  return SETTINGS_VIEWS.has(view);
}

// ── Lookups ────────────────────────────────────────────────────

export function isStageId(view: ViewId): view is StageId {
  return view === "analyze" || view === "plan" || view === "work";
}

/**
 * The stage a view belongs to: the stage itself for a stage page, else the
 * first stage listing it as a section. Given `validViews`, only stages this
 * viewer has count — Token Usage is listed by Analysis and Work, and a Rex-only
 * viewer has neither, so there it belongs to no stage. Null for home,
 * settings, and anything no (available) stage lists.
 */
export function stageForView(view: ViewId, validViews?: ReadonlySet<ViewId>): StageId | null {
  if (isStageId(view)) return view;
  for (const id of STAGE_ORDER) {
    if (validViews && !validViews.has(id)) continue;
    if (STAGES[id].sections.some((s) => s.view === view || s.alt?.view === view)) return id;
  }
  return null;
}

/** Stages with a page in this scope — the stage id is only a valid view in its own scope. */
export function visibleStages(validViews: ReadonlySet<ViewId>): StageId[] {
  return STAGE_ORDER.filter((id) => validViews.has(id));
}
