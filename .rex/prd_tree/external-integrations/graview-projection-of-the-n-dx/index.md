---
id: "1fadb108-b5a8-405c-8699-bdba069663fc"
level: "feature"
title: "Graview projection of the n-dx knowledge graph"
status: "pending"
priority: "medium"
tags:
  - "graview"
  - "integration"
  - "product-map"
source: "ndx-capture"
acceptanceCriteria:
  - "`ndx graview emit .` writes a `graview-document` declaration and a `{nodes, edges}` seed snapshot under the layout's graview dir from the rex tree, sourcevision output and hench runs, and no package.json in the workspace lists a `@graview/*` or `graview` runtime dependency"
  - "`ndx graview check .` exits 0 on the n-dx checkout and on ../graview; `ndx graview serve .` and `ndx graview mcp .` run the spawned graview CLI on the emitted files"
  - "The projection is read-only: running any `ndx graview` command writes nothing under the rex, sourcevision or hench directories"
description: "Represent n-dx's metadata as one typed context graph using Graview's constructs (graview.dev; framework checkout at ../graview), so the knowledge that today sits in three on-disk silos (the rex PRD tree, sourcevision output, hench runs) is declared once as kinds, edges, lenses and rules, checked by `graview check`, rendered by `graview serve`, and exposed to agents by `graview mcp`.\n\nWhy Graview fits: rex v2 already is a graph. Areas, capabilities, constraints, changes and tasks carry stored edges (amends, touches, dependsOn, appliesTo, blockedBy, discoveredFrom, shippedIn) and computed ones (changedBy, boundBy, coChanges, realizedBy via N-DX-Item commit trailers to files to zones). Sourcevision adds zones, crossings, components and findings; hench adds runs and commits. Graview's lenses map almost one to one: board (changes by status), plan (plannedRelease), timeline (runs), blocks (blockedBy), coverage (capabilities x zones).\n\nThe seam: a read-only projection. Graview's CLI accepts a `graview-document` declaration (JSON: kinds, fields, edges, acts, rules, lenses) plus a `{nodes, edges}` seed snapshot, so n-dx emits those two files and spawns the `graview` CLI on them the way hench spawns the claude and codex CLIs. No n-dx package depends on `@graview/*`; the `graview` tool is a peer binary resolved from `graview.bin` config, PATH, or `npx -y graview@0.1.19`. Output is derived and gitignored under the layout's graview dir, like `.rex/.cache/prd.json`. The adapter consumes `PrdModel` only: the v2 reader already reads a v1 tree as changes, so one code path serves n-dx's own v1 checkout and any v2 repo.\n\nShape: a new coordination-level package `@n-dx/graview` (`packages/graview`) beside web, reading rex through its public API and sourcevision JSON and hench runs from disk via `resolveLayout`, with one gateway file per upstream package. Prerequisite: the rex v2 reader and derived-edge computations are not public today (also needed by \"Dashboard on the v2 model\", 89ecd7f3).\n\nDeferred follow-ups, not part of this feature: two-way writes through Graview's SyncEngine with rex as the system of record (rex stays the single PRD writer); embedding the graph in the dashboard (`@graview/embed` is React; an iframe on `graview serve` is the cheap route); publishing to graview.cloud via create_app from the document plus act_batch seeding.\n\nContext at capture (2026-10-09): n-dx PRD is v1 with the product-map migration pending; graview's PRD lives at ../graview/.ndx/rex/prd_tree and has no existing n-dx-integration intent. n-dx's sourcevision scan dates from 2026-10-02 and should be refreshed before dogfooding; graview's is from 2026-10-08."
lastModified: "2026-10-10T03:10:04.843Z"
lastModifiedBy: "Nick Daniel <nick@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Promote the rex v2 reader and derived-edge computations to the public API](./promote-the-rex-v2-reader-and-derived.md) | pending |
| [@n-dx/graview adapter: declaration document, snapshot projection and ndx graview spawn commands](./n-dx-graview-adapter-declaration.md) | pending |
