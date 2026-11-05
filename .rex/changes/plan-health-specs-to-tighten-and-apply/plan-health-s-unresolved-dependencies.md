---
id: "532ac6eb-1c9c-4780-9044-248e61af82fd"
type: "task"
title: "Plan health's Unresolved dependencies light counts duplicate ids and self-references"
slug: "plan-health-s-unresolved-dependencies"
description: "Scenario: a PRD with two items sharing an id, or an item blockedBy itself, and no unknown blockedBy reference → the Plan health tile shows \"Unresolved dependencies · Failing · 1\", naming a problem the PRD does not have. Evidence: packages/web/src/viewer/views/plan-health.ts LIGHTS maps the light to the \"DAG integrity\" check, which packages/web/src/server/routes-validation.ts validateDAG fills with duplicate-id, self-reference and orphan-reference errors alike. Reachable from the Plan page on any project with a duplicate id or a self-block. Verdict: should-fix (adversarial review of 7441aa5c). Severity low: the light still turns red for a real integrity fault, but the label misdirects. Options: (A, recommended) have the route emit unknown blockedBy references as their own check (e.g. \"unresolved dependencies\") and keep duplicates/self-references in DAG integrity; the light reads the new check. Small, server-side, one more check row in the Validation view. (B) Rename the light \"Dependency integrity\". Cheapest, but drops the design's named light."
acceptanceCriteria:
  - "A PRD whose only fault is a duplicate id leaves the Unresolved dependencies light OK"
  - "A PRD with a blockedBy reference to an unknown id turns the Unresolved dependencies light to failing with a count of 1"
  - "A test in plan-health.test.ts or routes-validation.test.ts covers both cases"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
