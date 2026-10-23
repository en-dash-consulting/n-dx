---
id: "a699a497-d58e-4c3d-afc7-b029b2b3c2ee"
type: "change"
title: "Auto-tag PRD items created during self-heal runs with 'self-heal' marker"
slug: "auto-tag-prd-items-created-during-self"
intent: "When ndx self-heal creates new PRD items (via rex add, recommend --accept, or direct MCP writes), automatically apply the 'self-heal' tag to each item at creation time. This covers items created during the analyze → recommend → execute cycle within a self-heal run."
acceptanceCriteria:
  - "All PRD items created via ndx self-heal carry the 'self-heal' tag"
  - "Items created outside of self-heal (manual adds, ndx plan) do NOT receive the tag"
  - "Tag is written to prd storage at item creation time, not applied post-hoc"
  - "Existing PRD items without the tag are not modified by a self-heal run"
touches:
  - "2e184cee-25e9-4811-af0a-da72bb9c366f"
priority: "high"
tags:
  - "self-heal"
  - "rex"
  - "hench"
source: "smart-add"
---
