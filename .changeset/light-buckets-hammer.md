---
"@n-dx/web": patch
---

Add the Product page, Changes view and capability page for the v2 product and change layers, rendered from fixtures.

The Product page lists areas and capabilities with their computed status and health, draws each open change as an overlay on the capability it will amend, and marks the rows where the spec has moved ahead of the build (revised) or what was built is broken (defective). The Changes view groups work by planned release and then by stage, with the unscheduled backlog last. The capability page shows a capability's statement, its criteria including inherited ones, the history of changes that moved it, and where it lives in code.

The three views are driven entirely by props and ship with v2 fixtures. No routes are wired and no existing view changes, so they can be built ahead of the v2 reader.
