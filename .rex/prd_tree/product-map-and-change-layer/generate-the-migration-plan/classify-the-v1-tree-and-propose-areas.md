---
id: "6b78242d-169b-4db5-8a6f-dee4d78da413"
level: "task"
title: "Classify the v1 tree and propose areas and constraints"
status: "completed"
priority: "high"
tags:
  - "pr-13"
  - "lane-migration"
  - "rex"
  - "core"
source: "roadmap"
startedAt: "2026-10-08T17:02:44.783Z"
completedAt: "2026-10-08T17:13:49.990Z"
endedAt: "2026-10-08T17:13:49.990Z"
resolutionType: "code-change"
resolutionDetail: "Added classifyV1Tree in packages/rex/src/core/migration-plan.ts with unit tests. Every v1 item gets an entry with a target, and release-named epics never become areas (tested). On this repo it gives 2153 of 2153 items an entry."
acceptanceCriteria:
  - "Every v1 item appears in the plan with a target"
  - "Release-named epics never become areas (test)"
description: "Generic rules: an epic with a release or PR token becomes changes (an umbrella splits per feature); other epics become areas; capability-shaped features become capabilities; fix- or work-shaped features become applied changes that touch or amend their capability, tasks kept; uncertain items are held with needsPlacement. Propose a job-shaped area list and constraints."
lastModified: "2026-10-08T17:13:50.337Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
