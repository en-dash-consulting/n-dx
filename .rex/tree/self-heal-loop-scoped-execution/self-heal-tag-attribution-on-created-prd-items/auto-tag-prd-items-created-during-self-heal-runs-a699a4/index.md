---
id: "a699a497-d58e-4c3d-afc7-b029b2b3c2ee"
level: "task"
title: "Auto-tag PRD items created during self-heal runs with 'self-heal' marker"
status: "completed"
priority: "high"
tags:
  - "self-heal"
  - "rex"
  - "hench"
source: "smart-add"
startedAt: "2026-04-24T18:45:57.994Z"
completedAt: "2026-04-24T18:55:40.211Z"
resolutionType: "code-change"
resolutionDetail: "Added NDX_SELF_HEAL env var propagation in core self-heal, plus withSelfHealTag helper that rex's FileStore.addItem and createItemsFromRecommendations use to stamp the 'self-heal' tag at creation time. Tests cover both self-heal and non-self-heal paths, and the updateItem path is confirmed not to retag existing items."
acceptanceCriteria:
  - "All PRD items created via ndx self-heal carry the 'self-heal' tag"
  - "Items created outside of self-heal (manual adds, ndx plan) do NOT receive the tag"
  - "Tag is written to prd storage at item creation time, not applied post-hoc"
  - "Existing PRD items without the tag are not modified by a self-heal run"
description: "When ndx self-heal creates new PRD items (via rex add, recommend --accept, or direct MCP writes), automatically apply the 'self-heal' tag to each item at creation time. This covers items created during the analyze → recommend → execute cycle within a self-heal run."
---
