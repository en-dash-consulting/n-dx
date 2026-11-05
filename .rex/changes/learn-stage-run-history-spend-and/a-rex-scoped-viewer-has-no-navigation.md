---
id: "16f0fc5c-2ffb-4b10-8ac6-c3ef21a72464"
type: "task"
title: "A Rex-scoped viewer has no navigation to the PRD Graph or the Execution Log after they moved to Tune"
slug: "a-rex-scoped-viewer-has-no-navigation"
description: "Verdict: should-fix (medium). Found by adversarial review of 03b6cc9a.\n\nScenario: run the standalone Rex viewer (scope \"rex\"). buildValidViews(\"rex\") has no \"tune\", so visibleStages drops Tune. merge-graph and activity used to be sections of Plan (rex scope); they are now tiles of Tune only (packages/web/src/viewer/views/stages.ts tune StageDef). The Rex viewer therefore has no stage page, tab or section that reaches them, and stageForView returns null for them, so no tab lights when opened by URL. Same for hench-runs before (it was on Plan, now Tune, and Tune is in hench scope, so hench is fine).\n\nReachable: any `rex` standalone viewer (VIEWS_BY_SCOPE in packages/web/src/shared/view-routing.ts).\n\nOptions:\n1. Add \"tune\" to REX_SCOPE_VIEWS too (cheap; Tune shows the tiles the scope has: PRD Graph, Execution Log as Runs' tab is hidden when hench-runs is invalid, so Execution Log needs its own tile or the tab logic must fall back). Risk: Tune is a hench-product stage in a Rex viewer.\n2. Make a tile whose own view is out of scope promote its first valid tab to the tile (fixes activity under Runs), plus option 1. Recommended.\n3. Accept the loss and document that standalone Rex viewers drop these views."
acceptanceCriteria:
  - "With buildValidViews(\"rex\"), some visible stage places merge-graph and activity (stageForView returns a stage for each)"
  - "A unit test renders the rex-scoped dashboard and finds a navigable entry for the PRD Graph and the Execution Log"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
