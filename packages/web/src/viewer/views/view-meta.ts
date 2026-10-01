/**
 * The navigation model: one entry per view, and the only place a view's name
 * is written down.
 *
 * Before this module the same view was named in four tables that had drifted
 * apart — the breadcrumb called `graph` "Map", the Analysis stage called it
 * "Repository map", and `hench-runs` and `activity` were both "History". A
 * label is a thing the reader navigates by, so it has to be one string: the
 * top nav, the stage pages, the Home cards, the breadcrumb, `document.title`,
 * the guide and the settings overlay all read this table.
 *
 * `stages.ts` says *where* each view is placed and re-exports this module;
 * this one says what it is called. Every `ViewId` has exactly one entry —
 * `satisfies Record<ViewId, ViewMeta>` makes a missing one a compile error.
 *
 * Pure data and pure functions — no Preact — so views import it directly and
 * components reach it through `api.ts`.
 */

import type { ViewId } from "../types.js";

/** The package a view belongs to; `global` for views no single package owns. */
export type ViewProduct = "sourcevision" | "rex" | "hench" | "global";

export interface ViewMeta {
  /**
   * The view's name everywhere it is navigated to. Unique across views — two
   * destinations with one name is a navigation bug, and
   * `navigation-model.test.ts` fails on it.
   *
   * May contain the `{cli}` placeholder for the project's resolved binary
   * name; callers that render a label run it through `resolveCliLabel`.
   */
  label: string;
  /** Decorative mark shown beside the label. Never the accessible name. */
  glyph: string;
  product: ViewProduct;
  /** One line saying what the view is for. */
  blurb: string;
}

/**
 * Every view, by id.
 *
 * `as const satisfies` gives two things at once: the compiler rejects a
 * missing or misspelt `ViewId`, and lookups stay narrow — `VIEW_META[stage]`
 * for a `StageId` yields a `product` of exactly `sourcevision | rex | hench`,
 * which is what lets `stages.ts` type its product without restating it.
 */
export const VIEW_META = {
  // ── Shell ────────────────────────────────────────────────────
  home: {
    label: "Home",
    glyph: "⌂",
    product: "global",
    blurb: "The three stages of the loop, side by side, each with its headline numbers.",
  },

  // ── Stages ───────────────────────────────────────────────────
  analyze: {
    label: "Analysis",
    glyph: "▣",
    product: "sourcevision",
    blurb: "What the codebase looks like: files, zones, imports and the findings worth acting on.",
  },
  plan: {
    label: "Plan",
    glyph: "☑",
    product: "rex",
    blurb: "What to build next: the PRD, proposals from analysis, and the planning commands.",
  },
  work: {
    label: "Work",
    glyph: "▶",
    product: "hench",
    blurb: "Get it done: hand the next task to the agent, pick a run mode, watch what it costs.",
  },

  // ── SourceVision ─────────────────────────────────────────────
  overview: {
    label: "Overview",
    glyph: "▤",
    product: "sourcevision",
    blurb: "Counts, health and coupling, the largest zones.",
  },
  graph: {
    label: "Repository Map",
    glyph: "▧",
    product: "sourcevision",
    blurb: "The import graph, drawn flat or as an isometric block map.",
  },
  "iso-map": {
    label: "Isometric Map",
    glyph: "◧",
    product: "sourcevision",
    blurb: "The same import graph as a 3D block map.",
  },
  zones: {
    label: "Zones",
    glyph: "⬢",
    product: "sourcevision",
    blurb: "Clusters of files that import each other more than the rest.",
  },
  files: {
    label: "Files",
    glyph: "☰",
    product: "sourcevision",
    blurb: "The inventory, by role and language.",
  },
  routes: {
    label: "Routes",
    glyph: "◇",
    product: "sourcevision",
    blurb: "Pages, API routes and layouts.",
  },
  architecture: {
    label: "Architecture",
    glyph: "◨",
    product: "sourcevision",
    blurb: "Patterns and layering across zones.",
  },
  problems: {
    label: "Problems",
    glyph: "⚠",
    product: "sourcevision",
    blurb: "Findings from the enrichment passes.",
  },
  suggestions: {
    label: "Suggestions",
    glyph: "✨",
    product: "sourcevision",
    blurb: "Improvements the analysis proposes.",
  },
  "pr-markdown": {
    label: "PR Markdown",
    glyph: "✍",
    product: "sourcevision",
    blurb: "The analysis as a pull-request summary.",
  },
  // Once Ask works here, the same panel is wanted on the Rex and Hench
  // surfaces. That is deliberately not tracked in the PRD yet: generalise this
  // one first, then lift the shared piece out. Adoption markers for the other
  // two domains are in domain-rex.ts and domain-hench.ts.
  ask: {
    label: "Ask",
    glyph: "?",
    product: "sourcevision",
    blurb: "Question the analysis in plain language.",
  },

  // ── Rex ──────────────────────────────────────────────────────
  analysis: {
    label: "Add Items",
    glyph: "✚",
    product: "rex",
    blurb: "Describe work, import a document, or turn analysis into proposals.",
  },
  prd: {
    label: "Tasks",
    glyph: "▦",
    product: "rex",
    blurb: "The full PRD tree — epics, features, tasks.",
  },
  "rex-dashboard": {
    label: "Up Next",
    glyph: "◎",
    product: "rex",
    blurb: "The next task with its run button, progress and open epics.",
  },
  "merge-graph": {
    label: "PRD Graph",
    glyph: "◈",
    product: "rex",
    blurb: "How the PRD's items connect.",
  },
  validation: {
    label: "Validation",
    glyph: "✓",
    product: "rex",
    blurb: "Structural checks on the PRD.",
  },
  requirements: {
    label: "Requirements",
    glyph: "▥",
    product: "rex",
    blurb: "Acceptance criteria and where they are tested.",
  },
  activity: {
    label: "Execution Log",
    glyph: "≡",
    product: "rex",
    blurb: "Completions and mutations as the agent recorded them.",
  },

  // ── Hench ────────────────────────────────────────────────────
  "hench-runs": {
    label: "Runs",
    glyph: "⟳",
    product: "hench",
    blurb: "What the agent has run, most recent first.",
  },
  "hench-audit": {
    label: "Audit",
    glyph: "◉",
    product: "hench",
    blurb: "Per-task run logs and outcomes.",
  },
  "hench-templates": {
    label: "Templates",
    glyph: "▭",
    product: "hench",
    blurb: "Run presets: limits, guard rails, provider.",
  },
  "hench-optimization": {
    label: "Optimization",
    glyph: "↗",
    product: "hench",
    blurb: "Where runs spend their turns.",
  },
  "hench-adaptive": {
    label: "Adaptive",
    glyph: "◐",
    product: "hench",
    blurb: "Settings the runs have tuned themselves.",
  },

  // ── Cross-cutting ────────────────────────────────────────────
  "command-reference": {
    label: "All Commands",
    glyph: "⌘",
    product: "global",
    blurb: "Every command, with the ones you can run from here.",
  },
  "token-usage": {
    label: "Token Usage",
    glyph: "◷",
    product: "global",
    blurb: "Tokens and estimated cost by period and package.",
  },
  workspaces: {
    label: "Workspaces",
    glyph: "⌗",
    product: "global",
    blurb: "Every worktree of this repository and what each is running.",
  },

  // ── Settings ─────────────────────────────────────────────────
  "robot-wrangler": {
    label: "Robot Wrangler",
    glyph: "\u{1F9E0}",
    product: "global",
    blurb: "Which model answers, and the credentials it answers with.",
  },
  "project-settings": {
    label: "{cli} analyze / plan",
    glyph: "▣",
    product: "global",
    blurb: "Defaults for the analysis and planning commands.",
  },
  "hench-config": {
    label: "{cli} work",
    glyph: "▶",
    product: "global",
    blurb: "Defaults for agent runs: limits, guard rails, provider.",
  },
  "notion-config": {
    label: "{cli} sync",
    glyph: "\u{1F50C}",
    product: "global",
    blurb: "Push and pull the PRD through a Notion database.",
  },
  integrations: {
    label: "Integrations",
    glyph: "\u{1F517}",
    product: "rex",
    blurb: "Other trackers this PRD can sync with.",
  },
  commands: {
    label: "{cli} export / refresh",
    glyph: "\u{1F4E4}",
    product: "global",
    blurb: "Defaults for the export and refresh commands.",
  },
  "feature-toggles": {
    label: "Feature Flags",
    glyph: "\u{1F4CC}",
    product: "global",
    blurb: "Turn optional surfaces on and off.",
  },
  "cli-timeouts": {
    label: "CLI Timeouts",
    glyph: "⏱",
    product: "global",
    blurb: "How long each command may run before it is stopped.",
  },
} as const satisfies Record<ViewId, ViewMeta>;

/**
 * Display name per product, used as the second segment of `document.title`.
 * `global` keeps the name the dashboard has always used for views no one
 * package owns.
 */
export const PRODUCT_LABELS: Readonly<Record<ViewProduct, string>> = {
  sourcevision: "SourceVision",
  rex: "Rex",
  hench: "Hench",
  global: "Global",
};

export function viewMeta(view: ViewId): ViewMeta {
  return VIEW_META[view];
}

/** The view's name. May contain `{cli}` — resolve before rendering. */
export function viewLabel(view: ViewId): string {
  return VIEW_META[view].label;
}

export function viewBlurb(view: ViewId): string {
  return VIEW_META[view].blurb;
}

export function viewGlyph(view: ViewId): string {
  return VIEW_META[view].glyph;
}

export function viewProduct(view: ViewId): ViewProduct {
  return VIEW_META[view].product;
}

/** The product segment of `document.title`. */
export function viewProductLabel(view: ViewId): string {
  return PRODUCT_LABELS[VIEW_META[view].product];
}
