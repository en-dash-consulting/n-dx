---
"@n-dx/web": patch
---

Add a dashboard glossary and render definition lines for terms an outside
first-use review could not explain.

An outside first-use review could not tell what "zone", "zone pin",
"enrichment pass", "archetype", "guard rail", "epic / feature / task" or
"worktree anchor" meant, because the dashboard showed those terms with no
explanation.

- `packages/web/src/viewer/components/glossary-terms.ts` is the single source
  of truth: one plain-language sentence per term. `GlossaryLine` (a new
  viewer component) renders it where each term first appears.
- Wired at: Files (`archetype`, the Archetype column), Zones (`zone`, under
  the page's stat line), the zone detail slideout (`zone pin`, only when the
  zone has a pinned file, so the definition sits beside the "pinned" badge
  it explains), enrichment-gated views (`enrichment pass`, under the
  "Requires enrichment pass N" gate), the PRD tree (`epic / feature / task`,
  under the Tasks header), Workspaces (`worktree anchor`, under the page
  subtitle), and hench Config's Guard Rails category (`guard rail`).
- The Files table reads the archetype definition to screen readers once, as
  the table's description (`aria-describedby`); the copy shown in the column
  header is marked decorative, so it is not repeated for every cell.
- "weight" is not in the glossary: the dashboard never shows the word (the
  Zones view shows call counts), and CONTEXT.md's "weighted avg cohesion"
  means weighted by file count, a different thing.
- Tests: every glossary term is wired to a view, and render tests check the
  conditional placements (guard rail, zone pin) and the Files table's
  accessibility markup.

No route, view id, config key, or `--format=json` output changed, and no
gateway export was added. The web boundary check's two-consumer rule for
`src/shared/` now counts a zone only when it imports that module's own
symbols; before, any import of the shared barrel counted for every module,
so the rule could not fail.
