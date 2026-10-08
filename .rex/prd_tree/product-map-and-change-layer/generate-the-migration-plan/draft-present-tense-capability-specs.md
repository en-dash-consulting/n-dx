---
id: "2125f0cb-b864-490a-b482-0d4400438a2c"
level: "task"
title: "Draft present-tense capability specs grounded in code and tests"
status: "completed"
priority: "high"
tags:
  - "pr-13"
  - "lane-migration"
  - "rex"
  - "core"
blockedBy:
  - "6b78242d-169b-4db5-8a6f-dee4d78da413"
source: "roadmap"
startedAt: "2026-10-08T17:14:54.790Z"
completedAt: "2026-10-08T17:30:03.444Z"
endedAt: "2026-10-08T17:30:03.444Z"
resolutionType: "code-change"
resolutionDetail: "Added draftCapabilitySpecs in packages/rex/src/core/capability-spec.ts with unit tests. Every capability gets a statement (tested; 306/306 on this repo), and criteria with matching tests carry an automated requirement (tested)."
acceptanceCriteria:
  - "Every capability in the plan has a drafted statement"
  - "Criteria with matching tests carry an automated requirement"
description: "For each capability, draft a statement and EARS-style criteria from its source items, history, sourcevision file info and verify_criteria test links (linked tests become automated requirements). Mark specReviewed false."
lastModified: "2026-10-08T17:30:06.117Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
