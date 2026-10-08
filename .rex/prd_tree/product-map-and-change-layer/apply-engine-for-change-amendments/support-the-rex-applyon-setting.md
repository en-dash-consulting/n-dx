---
id: "a04c1618-8122-4010-8194-b62c746dcb67"
level: "task"
title: "Support the rex.applyOn setting: complete, review and release"
status: "completed"
priority: "high"
tags:
  - "pr-10"
  - "lane-rex-domain"
  - "rex"
blockedBy:
  - "17a8312b-14b6-45c8-8908-a51dad483249"
source: "roadmap"
startedAt: "2026-10-08T04:34:27.633Z"
completedAt: "2026-10-08T04:44:26.251Z"
endedAt: "2026-10-08T04:44:26.251Z"
resolutionType: "code-change"
resolutionDetail: "core/apply-policy.ts: parseApplyOn/loadApplyOn (rex.applyOn from .n-dx.json, default complete), appliesOn, applyOnTrigger (complete|steward|release), changesAwaitingApply; tests per mode in tests/unit/core/apply-policy.test.ts."
acceptanceCriteria:
  - "Each mode is covered by a test"
  - "The setting is read from .n-dx.json with complete as default"
description: "complete (default) applies when a change completes on its branch; review waits for an explicit apply by a steward; release applies at release stamping. A completed but unapplied change keeps its capabilities changing."
lastModified: "2026-10-08T04:44:27.925Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
