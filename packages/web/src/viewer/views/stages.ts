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
 * It says *where* a view sits; `view-meta.ts` — re-exported below, so callers
 * need one import — says what it is *called*. A section therefore names only
 * a view id: its heading and blurb are the view's own, which is why the stage
 * page and the breadcrumb can no longer disagree about what a view is named.
 *
 * Pure data and pure functions — no Preact — so both components and views
 * can import it (components through api.ts).
 */

import type { ViewId } from "../types.js";
import { VIEW_META } from "./view-meta.js";

export * from "./view-meta.js";

export type StageId = "analyze" | "plan" | "work";

export type StageProduct = "sourcevision" | "rex" | "hench";

export interface StageSection {
  /**
   * View rendered in the section and opened full-page by its "Open" link.
   * The section's heading and blurb come from this view's entry in
   * `view-meta.ts`; there is no per-section override.
   */
  view: ViewId;
  /** Expanded when the stage page first opens. */
  open?: boolean;
  /**
   * The stage's lead section, shown in the page itself with no dropdown
   * header: always rendered, never collapsible. One per stage, first.
   */
  plain?: boolean;
  /**
   * A second projection of the same content behind a toggle in the section
   * header — the 2D import map and the 3D isometric map are one section.
   */
  alt?: { view: ViewId; label: string; primaryLabel: string };
  /**
   * A long list (run history, the execution log): the open section is a
   * bounded scroll region, with an Expand control in its header that shows it
   * at full length. The choice is remembered per section.
   */
  scroll?: boolean;
  /**
   * The view owns a full-height layout of its own (the Tasks tree: a pinned
   * filter bar over a virtual scroller that sizes itself from its container),
   * so the section gives it a bounded-height flex body to fill.
   */
  fill?: boolean;
  /** Hidden when this feature toggle is off (same keys as `useFeatureToggle`). */
  featureGate?: string;
  /** Built on demand by the server — absent from a static export. */
  requiresServer?: boolean;
}

export interface StageDef {
  id: StageId;
  sections: readonly StageSection[];
}

/** Loop order. The side stage links step through it and wrap. */
export const STAGE_ORDER: readonly StageId[] = ["analyze", "plan", "work"];

export const STAGES: Readonly<Record<StageId, StageDef>> = {
  analyze: {
    id: "analyze",
    sections: [
      { view: "overview", plain: true },
      { view: "graph", alt: { view: "iso-map", label: "3D", primaryLabel: "2D" } },
      { view: "zones" },
      { view: "files", scroll: true },
      { view: "problems" },
      { view: "suggestions" },
      { view: "architecture" },
      { view: "routes" },
      { view: "pr-markdown", featureGate: "sourcevision.prMarkdown" },
      { view: "ask", featureGate: "sourcevision.ask", requiresServer: true },
    ],
  },
  plan: {
    id: "plan",
    sections: [
      { view: "analysis", plain: true },
      { view: "prd", open: true, fill: true },
      { view: "command-reference" },
      { view: "hench-runs", scroll: true },
      { view: "merge-graph" },
      { view: "validation" },
      { view: "requirements" },
    ],
  },
  work: {
    id: "work",
    sections: [
      { view: "rex-dashboard", plain: true },
      { view: "activity", scroll: true },
      { view: "hench-templates" },
      { view: "token-usage" },
      { view: "hench-audit" },
      { view: "hench-optimization" },
      { view: "hench-adaptive" },
      { view: "workspaces", requiresServer: true },
    ],
  },
};

/**
 * The stage's product, narrowed to the three packages.
 *
 * `VIEW_META` is declared `as const`, so indexing it by a `StageId` gives the
 * three literal products and not the wider `ViewProduct` — the stage's colour,
 * logo and CSS class come from the same table as its name, with no second
 * declaration to keep in step.
 */
export function stageProduct(stage: StageId): StageProduct {
  return VIEW_META[stage].product;
}

// ── Settings ───────────────────────────────────────────────────

export interface SettingsEntry {
  /** Label and glyph come from this view's entry in `view-meta.ts`. */
  view: ViewId;
  featureGate?: string;
}

/** Workflow order: General → analyze/plan → work → sync → export, then cross-cutting. */
export const SETTINGS_ENTRIES: readonly SettingsEntry[] = [
  { view: "llm-provider" },
  { view: "project-settings" },
  { view: "hench-config" },
  { view: "notion-config", featureGate: "rex.notionSync" },
  { view: "integrations", featureGate: "rex.integrations" },
  { view: "commands" },
  { view: "feature-toggles" },
  { view: "cli-timeouts" },
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
 * stage listing it as a section. Each view is listed by at most one stage, so
 * the answer never depends on where the user came from — a view listed twice
 * would light the first stage in loop order even when opened from the second.
 * Given `validViews`, only stages this viewer has count: Token Usage is on
 * Work, so a Rex-only viewer has it in no stage. Null for home, settings, and
 * anything no (available) stage lists.
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
