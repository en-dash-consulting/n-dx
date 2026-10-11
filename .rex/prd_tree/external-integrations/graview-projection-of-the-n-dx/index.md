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
description: "Represent n-dx's metadata as one typed context graph using Graview's constructs (graview.dev; framework checkout at ../graview), so the knowledge that today sits in three on-disk silos (the rex PRD tree, sourcevision output, hench runs) is declared once as kinds, edges, lenses and rules, checked by `graview check`, rendered by `graview serve`, and exposed to agents by `graview mcp`.\n\nWhy Graview fits: rex v2 already is a graph. Areas, capabilities, constraints, changes and tasks carry stored edges (amends, touches, dependsOn, appliesTo, blockedBy, discoveredFrom, shippedIn) and computed ones (changedBy, boundBy, coChanges, realizedBy via N-DX-Item commit trailers to files to zones). Sourcevision adds zones, crossings, components and findings; hench adds runs and commits. Graview's lenses map almost one to one: columns (changes by status), timeline (runs), coverage (capabilities x zones), calendar (shipped changes), blocks (attention, spend).\n\nThe seam: a read-only projection. Graview's CLI accepts a `graview-document` declaration (JSON: kinds, fields, edges, acts, rules, lenses, views, brand) plus a `{nodes, edges}` seed snapshot, so n-dx emits those two files and spawns the `graview` CLI on them the way hench spawns the claude and codex CLIs. No n-dx package depends on `@graview/*`; the `graview` tool is a peer binary resolved from `graview.bin` config, PATH, or `npx -y graview@0.1.19`. Output is derived and gitignored under the layout's graview dir, like `.rex/.cache/prd.json`. The adapter consumes `PrdModel` only: the v2 reader already reads a v1 tree as changes, so one code path serves n-dx's own v1 checkout and any v2 repo.\n\nShape: a new coordination-level package `@n-dx/graview` (`packages/graview`) beside web, reading rex through its public API and sourcevision JSON and hench runs from disk via `resolveLayout`, with one gateway file per upstream package. The React-dependent product face lives in a sibling repo `n-dx-graview` (the way ../bee-bot is a product on Graview), built from the emitted document with `appFromOrCompile`, so the declaration has one source of truth in n-dx.\n\nDelivery, as a stack of PRs on `prd/graview-projection` (merge commits; base each PR on the branch below, merge bottom-up):\n1. This PRD capture (the feature and its four tasks).\n2. Promote the rex v2 reader and derived-edge computations to the public API (ee838683). Unrelated to Graview in itself; also unblocks \"Dashboard on the v2 model\".\n3. @n-dx/graview adapter: declaration document, snapshot projection and ndx graview spawn commands (c03409a5).\n4. n-dx on Graview: declared design and a custom pages face, in n-dx's own words (3cf80a6e). The declaration half lands in n-dx; the pages face in n-dx-graview.\n5. Two-way writes through Graview's SyncEngine with rex as the system of record (424ddbbe). The RemoteSystem lives in the product repo and writes through rex's HTTP MCP endpoint.\n\nStill deferred beyond this feature: embedding the graph in the n-dx dashboard (an iframe on `graview serve` is the cheap route; `@graview/embed` is React) and publishing to graview.cloud via create_app from the document plus act_batch seeding.\n\nContext at capture (2026-10-09): n-dx PRD is v1 with the product-map migration pending; graview's PRD lives at ../graview/.ndx/rex/prd_tree and has no existing n-dx-integration intent; the product-map design doc linked from that epic is in another Claude org. n-dx's sourcevision scan dates from 2026-10-02 and should be refreshed before dogfooding; graview's is from 2026-10-08."
lastModified: "2026-10-10T03:41:32.405Z"
lastModifiedBy: "Nick Daniel <nick@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [@n-dx/graview adapter: declaration document, snapshot projection and ndx graview spawn commands](./n-dx-graview-adapter-declaration.md) | pending |
| [n-dx on Graview: declared design and a custom pages face, in n-dx's own words](./n-dx-on-graview-declared-design-and-a.md) | pending |
| [Promote the rex v2 reader and derived-edge computations to the public API](./promote-the-rex-v2-reader-and-derived.md) | pending |
| [Two-way writes through Graview's SyncEngine with rex as the system of record](./two-way-writes-through-graview-s.md) | pending |
