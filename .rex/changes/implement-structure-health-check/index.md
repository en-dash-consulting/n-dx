---
id: "bf1fd080-e3f7-4af9-8ee3-1626df8da8d7"
type: "change"
title: "Implement structure health check function"
slug: "implement-structure-health-check"
intent: "Create a core/structure-health.ts function that evaluates the PRD tree against the configured thresholds. Returns a list of warnings (not errors) with severity and suggested action. Reuses metrics from the existing health command but adds threshold comparison."
acceptanceCriteria:
  - "Function takes PRD items + thresholds, returns warnings array"
  - "Checks: epic count, max depth, oversized containers, undersized containers"
  - "Each warning includes what threshold was crossed and suggested fix"
  - "Unit tests cover each threshold type"
amends: [{"target":"f0294876-d42d-497e-a3c6-c5abf7a374ed","delta":"modified","summary":"Implement structure health check function","base":"64dbbc9b61e13902418f831f744c890674e5efbe99ba153342cdf7897343fb50"}]
priority: "high"
tags:
  - "rex"
blockedBy:
  - "6ce9b707-d96d-4133-a871-bd663e6d966c"
---
