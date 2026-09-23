/**
 * Dashboard glossary — the single source of truth for the plain-language
 * definitions rendered under dashboard fields and column headers.
 *
 * An outside first-use review of the dashboard could not tell what "zone",
 * "zone pin", "enrichment pass", "archetype", "weight", "guard rail",
 * "epic / feature / task" or "worktree anchor" meant, because those words
 * appear on screen with no explanation. This module holds one definition per
 * term; `GlossaryLine` (`viewer/components/glossary-line.ts`) renders it
 * where each term first appears on a page. Adding a term here and wiring one
 * `GlossaryLine` call is the whole change — there is no second place that
 * writes definition text.
 *
 * Framework-agnostic (no Preact, no `node:*` imports) so it can be imported
 * by both the server and the viewer, per the `src/shared/` addition policy
 * in `packages/web/CLAUDE.md`.
 */

export interface GlossaryTerm {
  /** The term as it appears in dashboard copy, e.g. "zone pin". */
  term: string;
  /** One plain-language sentence, grounded in what the code actually does. */
  definition: string;
}

export const GLOSSARY_TERMS: readonly GlossaryTerm[] = [
  {
    term: "zone",
    definition:
      "A cluster of files that import each other more than they import anything outside the cluster — found automatically by community detection (Louvain) over the import graph, not drawn by hand.",
  },
  {
    term: "zone pin",
    definition:
      "A manual override, stored in .n-dx.json, that assigns one file to a specific zone regardless of what community detection would otherwise choose.",
  },
  {
    term: "enrichment pass",
    definition:
      "One round of SourceVision's deeper analysis. Some views need a minimum pass count before they unlock; running analysis again advances the pass.",
  },
  {
    term: "archetype",
    definition:
      "The role SourceVision assigns a file — for example component, route, or utility — which can be overridden per file.",
  },
  {
    term: "weight",
    definition:
      "How much traffic — import or call count — flows along a connection between two zones or files. Heavier connections are drawn thicker and count for more in cross-zone totals.",
  },
  {
    term: "guard rail",
    definition:
      "A safety boundary — blocked paths, allowed commands, and file-size limits — that constrains what hench's autonomous agent may touch while it works.",
  },
  {
    term: "epic / feature / task",
    definition:
      "The three levels of the PRD hierarchy: an epic groups features, a feature groups tasks, and a task is the unit of work an agent picks up and completes.",
  },
  {
    term: "worktree anchor",
    definition:
      "The primary git worktree a project was registered from. Every other worktree's PRD and progress are shown as a difference against it.",
  },
];

/** Look up a term's definition. Returns undefined for an unknown term. */
export function getGlossaryDefinition(term: string): string | undefined {
  return GLOSSARY_TERMS.find((t) => t.term === term)?.definition;
}
