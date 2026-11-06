---
id: "3adf86fa-fa8e-4038-9b0c-b866f1281c4f"
type: "task"
title: "Ready to run re-runs full selection and the hench runs scan once per 50-row page"
slug: "ready-to-run-re-runs-full-selection"
description: "Verdict: should-fix (medium). Once Ready to run is expanded or a search/filter control is used, the viewer (packages/web/src/viewer/components/ready-to-run.ts, load()) fetches /api/hench/ready in sequential 50-row pages until `total`, and repeats that on every hench-runs live refresh. Each request (packages/web/src/server/routes-hench-prep.ts handleReady) re-reads the claims store, collectHeldRuns, loadStuckTaskIds (every run record under .hench/runs) and re-runs the whole findActionableWork selection, then slices one page. On a tree with ~3,000 actionable units that is ~60 sequential full passes per refresh. Reachable from the Work page on any large v2 tree. Options: (a) let the viewer ask for the whole list in one request (an `all=1` or a higher limit for the viewer's own call), cost: one bigger reply; (b) memoize the ranked list per PRD cache signature plus claims/runs state on the server, cost: an invalidation rule; (c) keep paging but raise the page size. Recommend (a): rows are small and the route already computes the whole list."
acceptanceCriteria:
  - "Loading every Ready to run row on a tree with 3,000 actionable tasks runs the selection and the hench runs scan once, not once per 50 rows (server test counting findActionableWork / run-record reads)"
  - "A live refresh while the list is expanded issues one ready request, not one per page (viewer test)"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
