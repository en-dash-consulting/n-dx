---
id: "9de61c8c-1473-4f2e-9304-64cb0d5091fc"
type: "task"
title: "Add the v2 validation rules as pure functions"
slug: "add-the-v2-validation-rules-as-pure"
description: "Errors: every change amends or touches something unless spike; no node title matches a version token or PR number; no nesting across layers; capabilities nest at most one level; dependsOn is acyclic; a removed delta targets a live node; every capability has a statement. Warnings: capability without criteria, long-revised, area balance (over 40 percent or under 2), unreviewed spec."
acceptanceCriteria:
  - "Each rule has unit tests for pass and fail"
  - "The title lint flags 0.8.0 and PR 12 style tokens and accepts plain titles"
priority: "high"
tags:
  - "pr-07"
  - "lane-rex-store"
  - "rex"
source: "roadmap"
blockedBy:
  - "51b89dab-a2b3-4ea1-82a1-974584bfe51d"
---
