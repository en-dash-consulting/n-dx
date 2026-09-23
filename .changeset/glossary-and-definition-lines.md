---
"@n-dx/web": patch
---

Add a dashboard glossary and render definition lines for terms an outside
first-use review could not explain.

An outside first-use review could not tell what "zone", "zone pin",
"enrichment pass", "archetype", "weight", "guard rail", "epic / feature /
task" or "worktree anchor" meant, because the dashboard showed those terms
with no explanation.

- `packages/web/src/shared/glossary.ts` is the single source of truth: one
  plain-language sentence per term. `GlossaryLine` (a new viewer component)
  renders it under the first field or column header that uses each term.
- Wired at: Files (`archetype`, the Archetype column header), Zones
  (`zone` and `weight`, under the page's stat line; `zone pin`, in the zone
  detail slideout's file list), enrichment-gated views (`enrichment pass`,
  under the "Requires enrichment pass N" gate), the PRD tree
  (`epic / feature / task`, under the Tasks header), Workspaces
  (`worktree anchor`, under the page subtitle), and hench Config's Guard
  Rails category (`guard rail`).
- A unit test (`tests/unit/shared/glossary.test.ts`) asserts every glossary
  term is rendered by at least one view, so an unwired term or a dead
  `GlossaryLine` call fails the build.

No route, view id, config key, or `--format=json` output changed. The
viewer's outbound gateway (`external.ts`) gained one export
(`getGlossaryDefinition`); its documented export ceiling moved from 33 to 34
with the usual inline justification.
