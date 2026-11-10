---
id: "105510b0-625b-4afd-8e26-a2bbdc79968d"
type: "task"
title: "Move Runs, Execution Log, Spend, Suggestions and PRD Graph into Tune"
slug: "move-runs-execution-log-spend-tuning"
description: "Tune's tiles: Runs (hench-runs, with activity as a tab, 8 columns by 2 rows), Spend (token-usage, relabelled), Suggestions (hench-optimization with hench-adaptive as a tab, relabelled from Tuning) and Shipped (merge-graph, relabelled). Remove hench-runs and merge-graph from Plan's sections and activity, token-usage, hench-optimization and hench-adaptive from Work's. Views keep their ids and routes; any route that resolved to a stage page now resolves to Tune. Live's \"Finished in the last hour\" links and the bottom bar's run count open Tune, and the Runs System status drawer goes because Live has the throttle and stop."
acceptanceCriteria:
  - "Tune shows Runs (Execution Log tab), Spend, Suggestions (Optimization and Adaptive tabs) and Shipped tiles; each opens full-screen and its Open link goes to the view's own route"
  - "Plan's sections no longer include hench-runs or merge-graph, and Work's no longer include activity, token-usage, hench-optimization or hench-adaptive"
  - "Old routes for every moved view still resolve, and the breadcrumb names Tune as their stage (restored-views test)"
  - "Live's finished-run links and the bottom bar's run count navigate to Tune"
priority: "high"
source: "ndx-capture"
blockedBy:
  - "03b6cc9a-78c6-4ac2-b034-253781e54e6e"
---
