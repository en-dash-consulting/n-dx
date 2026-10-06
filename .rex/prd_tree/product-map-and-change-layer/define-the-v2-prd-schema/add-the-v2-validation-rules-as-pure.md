---
id: "9de61c8c-1473-4f2e-9304-64cb0d5091fc"
level: "task"
title: "Add the v2 validation rules as pure functions"
status: "completed"
priority: "high"
tags:
  - "pr-07"
  - "lane-rex-store"
  - "rex"
blockedBy:
  - "51b89dab-a2b3-4ea1-82a1-974584bfe51d"
source: "roadmap"
startedAt: "2026-10-06T05:12:22.124Z"
completedAt: "2026-10-06T05:48:18.997Z"
endedAt: "2026-10-06T05:48:18.997Z"
resolutionType: "code-change"
resolutionDetail: "packages/rex/src/schema/v2-rules.ts: 7 error rules and 4 warning rules, plus specHash; each rule has pass and fail unit tests (v2-rules.test.ts)"
acceptanceCriteria:
  - "Each rule has unit tests for pass and fail"
  - "The title lint flags 0.8.0 and PR 12 style tokens and accepts plain titles"
description: "Errors: every change amends or touches something unless spike; no node title matches a version token or PR number; no nesting across layers; capabilities nest at most one level; dependsOn is acyclic; a removed delta targets a live node; every capability has a statement. Warnings: capability without criteria, long-revised, area balance (over 40 percent or under 2), unreviewed spec."
lastModified: "2026-10-06T05:48:20.291Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
