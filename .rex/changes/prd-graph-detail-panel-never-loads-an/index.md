---
id: "a5adacee-0840-4a7c-86e6-6a2b406e641b"
type: "change"
title: "PRD Graph detail panel never loads an item's introducing commit, and /api/prd-origin only knows prd_tree"
slug: "prd-graph-detail-panel-never-loads-an"
intent: "Found by the adversarial review of 637d5b5b (PRD Graph on a v2 tree); pre-existing, not introduced by it. Verdict: out-of-scope, medium.\n\nScenario: open the PRD Graph (Shipped tile) on any project and click a PRD node. The detail panel's introducing-commit section shows nothing. `ensureOrigin` in packages/web/src/viewer/views/merge-graph.ts (~line 1320) returns `origin: null` immediately when `node.treePath` is unset, and `flattenPrdItems` in packages/web/src/server/merge-history.ts never sets `treePath`, so `/api/prd-origin` is never called. Even if it were, packages/web/src/server/routes-merge-graph.ts (~line 182) builds `<rexDir>/prd_tree/<path>/index.md`, which does not exist on a v2 tree (changes live at `changes/<slug>/index.md`, tasks at `changes/<slug>/<task>.md` or a folder).\n\nReachable: every PRD node click in the dashboard.\n\nOptions: (A, recommended) have the server send each node's repo-relative item file path (v2 from the store's slug and folder shape, v1 from the prd_tree slug chain) and let /api/prd-origin take that path under the rex dir, validated as today; cost: one field and path validation change, risk low. (B) Resolve origin by the item id via `git log -S \"id: <uuid>\" --diff-filter=A`; no path plumbing but slower and fooled by moved files. (C) Drop the introducing-commit section; loses a capability criterion's detail."
acceptanceCriteria:
  - "Clicking a v2 change or task in the PRD Graph shows the commit that added its file, with author and Co-Authored-By trailers"
  - "Clicking a v1 item shows its introducing commit as /api/prd-origin resolves it under prd_tree/"
  - "A test fails when the graph payload omits the item path the origin lookup needs"
  - "/api/prd-origin rejects a path outside the rex directory"
touches:
  - "a32f8a34-2c34-4ea1-9652-d85d0ba4e8d2"
fix: true
priority: "medium"
discoveredFrom: {"item":"637d5b5b-b14e-441d-aa14-3c8944fec4fa","run":"12a5a8f6-e62b-407a-9659-55b883768b75"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "web"
  - "context-graph"
source: "ndx-adversarial-review"
---
