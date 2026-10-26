---
id: "5aa5da8f-9587-4ff6-a27a-379525a7fc04"
type: "task"
title: "Hench recommends execution order and loop bundles for ready tasks"
slug: "hench-recommends-execution-order-and"
description: "Rule-based queue planner (ndx work --plan-queue), shown as 'Ready next' on Live. CAOS story: https://www.notion.so/3f7a80b719248118bf40ee8742778786."
acceptanceCriteria:
  - "bundles share parent and worktree, small tier, disjoint touches or a dependency chain, ≤3 per branch"
  - "cold-only tags (review-critical, migration, cross-package) excluded"
  - "reason per inclusion/exclusion"
  - "respects the run limit"
priority: "medium"
source: "caos"
---
