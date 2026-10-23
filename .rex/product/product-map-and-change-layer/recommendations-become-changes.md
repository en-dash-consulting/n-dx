---
id: "bba223a0-f8a3-4bee-af4d-95d7d45646e9"
type: "capability"
title: "Recommendations become changes"
slug: "recommendations-become-changes"
statement: "sourcevision recommendations and analyze proposals enter the product as changes with suggested amends or touches, and PR markdown shows the product layer delta."
criteria: [{"id":"c1","text":"When a recommendation is accepted, rex shall create a change rather than an epic."},{"id":"c2","text":"When rex recommend or rex analyze turns a proposal into a change, rex shall attach suggested amends or touches to that change."},{"id":"c3","text":"sourcevision shall show the product layer delta in the PR markdown it generates."},{"id":"c4","text":"When sourcevision generates PR markdown, it shall not read the legacy .rex/prd.md file."},{"id":"c5","text":"When rex recommend creates a change from a sourcevision anti-pattern, structural or tech-debt finding, rex shall tag that change code-health."},{"id":"c6","text":"When rex analyze creates a change from a sourcevision anti-pattern, structural or tech-debt finding, rex shall tag that change code-health."},{"id":"c7","text":"When rex analyze proposes zone features or category epics as new work, rex shall not tag them code-health."}]
requirements: [{"id":"bba223a0-f8a3-4bee-af4d-95d7d45646e9:c1","title":"When a recommendation is accepted, rex shall create a change rather than an epic","description":"Linked to: packages/rex/tests/unit/recommend/create-from-recommendations.test.ts","category":"technical","validationType":"automated","acceptanceCriteria":["When a recommendation is accepted, rex shall create a change rather than an epic."]},{"id":"bba223a0-f8a3-4bee-af4d-95d7d45646e9:c4","title":"When sourcevision generates PR markdown, it shall not read the legacy .rex/prd.md file","description":"Linked to: packages/sourcevision/tests/unit/cli/pr-markdown-legacy-prd.test.ts","category":"technical","validationType":"automated","acceptanceCriteria":["When sourcevision generates PR markdown, it shall not read the legacy .rex/prd.md file."]},{"id":"bba223a0-f8a3-4bee-af4d-95d7d45646e9:c5","title":"When rex recommend creates a change from a sourcevision anti-pattern, structural or tech-debt finding, rex shall tag that change code-health","description":"Linked to: packages/rex/tests/unit/recommend/create-from-recommendations.test.ts","category":"technical","validationType":"automated","acceptanceCriteria":["When rex recommend creates a change from a sourcevision anti-pattern, structural or tech-debt finding, rex shall tag that change code-health."]}]
tags:
  - "product-map"
  - "pr-20"
  - "lane-models-analysis"
  - "sourcevision"
source: "roadmap"
priority: "medium"
---

sourcevision's recommendations enter through the one door: as changes with suggested amends or touches.

Roadmap PR 20 · wave 2 · lane models-analysis.
