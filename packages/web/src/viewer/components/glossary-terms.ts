/**
 * Dashboard glossary — the single source of truth for the plain-language
 * definitions rendered under dashboard fields and column headers.
 *
 * An outside first-use review of the dashboard could not tell what "zone",
 * "zone pin", "enrichment pass", "archetype", "guard rail",
 * "epic / feature / task" or "worktree anchor" meant, because those words
 * appear on screen with no explanation. This module holds one definition per
 * term; `GlossaryLine` (`glossary-line.ts`, beside this file) renders it as a
 * visible line where each term first appears on a page, and `InfoTip`
 * (`info-tip.ts`) renders it behind a hoverable ⓘ where a visible line would
 * crowd the layout — a column header, a metric card. Adding a term here and
 * wiring one `GlossaryLine` or `InfoTip` call is the whole change — there is
 * no second place that writes definition text.
 *
 * Every term must be a word the dashboard actually shows: a definition for a
 * word the reader cannot find on screen explains nothing. "weight" was
 * dropped for that reason — the Zones view shows call counts, never the word,
 * and the one place a user meets it (CONTEXT.md's "weighted avg cohesion")
 * means weighted by file count, not connection traffic.
 *
 * Lives in the viewer rather than `src/shared/`: the viewer is its only
 * consumer, and `src/shared/` requires two consumer zones
 * (`tests/integration/boundary-check.test.ts`).
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
      "One round of LLM analysis layered on SourceVision's automated scan: pass 1 names the zones, pass 2 maps how they depend on each other, pass 3 looks for anti-patterns, and pass 4 writes suggestions.",
  },
  {
    term: "archetype",
    definition:
      "The role SourceVision assigns a file — for example component, route, or utility — which can be overridden per file.",
  },
  {
    term: "guard rail",
    definition:
      "A safety boundary — blocked paths, allowed commands, and file-size limits — that constrains what hench's autonomous agent may touch while it works.",
  },
  {
    term: "epic / feature / task",
    definition:
      "The levels of the PRD hierarchy: an epic groups features, a feature groups tasks, and a task is the unit of work an agent picks up — a task can be broken down further into subtasks.",
  },
  {
    term: "worktree anchor",
    definition:
      "The primary git worktree a project was registered from. Every other worktree's PRD and progress are shown as a difference against it.",
  },
  {
    term: "cohesion",
    definition:
      "The share of a zone's imports that stay inside it. Higher means the zone holds together on its own; low cohesion together with high coupling is the combination worth watching.",
  },
  {
    term: "coupling",
    definition:
      "The share of a zone's imports that cross its boundary into other zones. Higher means the zone is more entangled with the rest of the codebase, so a change inside it reaches further.",
  },
  {
    term: "cross-zone import",
    definition:
      "An import whose file and target sit in different zones. The busiest boundaries are the zone pairs with the most of them — in most codebases, largely tests importing the code they test.",
  },
];

/** Look up a term's definition. Returns undefined for an unknown term. */
export function getGlossaryDefinition(term: string): string | undefined {
  return GLOSSARY_TERMS.find((t) => t.term === term)?.definition;
}
