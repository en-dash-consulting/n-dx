---
id: "218ce010-b292-444e-9501-f2d8fc8335e2"
level: "task"
title: "Build the brief from the change and the capabilities it affects"
status: "completed"
priority: "medium"
tags:
  - "pr-19"
  - "lane-hench"
  - "hench"
source: "roadmap"
startedAt: "2026-10-09T04:59:34.773Z"
completedAt: "2026-10-09T05:29:51.835Z"
endedAt: "2026-10-09T05:29:51.835Z"
resolutionType: "code-change"
resolutionDetail: "Added rex/core/change-brief.ts: builds the v2 agent brief from a WorkUnit and the product nodes its change affects, with a measured 4,000-token budget, entry-wise trimming and a compact fallback. 27 tests including three golden snapshots (feature, fix, task-less change)."
acceptanceCriteria:
  - "Golden brief tests for a feature change, a fix and a task-less change"
  - "The brief stays under the budget with section trimming (test)"
  - "The same brief is produced for Claude and Codex runs"
description: "Sections in priority order: task, siblings and change (intent, amendments with proposed text); each amended or touched capability (statement, criteria including inherited, requirements, health, specReviewed); applicable constraints; depends-on neighbours one hop; realized-by paths; last three changes; commands, workflow, log. One measured budget of about 4,000 tokens; capabilities and constraints kept first.\n\nLabel a capability's criteria 'capability criteria' and a work item's acceptanceCriteria 'done when' (terminology decided 2026-10-08)."
lastModified: "2026-10-09T05:29:52.069Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
