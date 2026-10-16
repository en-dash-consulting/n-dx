---
id: "0620ec56-4203-44f4-bd9f-75250e925aed"
level: "task"
title: "Dissolved containers keep their description, criteria and blockedBy"
status: "pending"
priority: "medium"
tags:
  - "pr-23"
  - "lane-migration"
  - "review-2026-10-12"
  - "v2-migrate-l7"
blockedBy:
  - "5fc180fd-0060-409f-98aa-8e0e429b54f1"
source: "review-2026-10-12"
acceptanceCriteria:
  - "A release epic with a description and acceptance criteria keeps both under its line in the cut change's body after apply (test; fails at 4646976bad)"
  - "A release epic blockedBy another release epic: its children carry blockedBy refs to the other epic's open children after apply, reusing the fde93c35 repoint (test; fails at 4646976bad)"
description: "Review of #689 (2026-10-12), should-fix, CONFIRMED (reviewer script container-deps.mjs plus the real-tree diff). packages/rex/src/migrations/v1-to-v2/apply.ts:146-151, 405-447: a release container becomes {id, title, plannedRelease} in the cut change's body; everything else on it is dropped while the id check counts it as landed.\n\nFailure scenario: v1 epic 'ndx 0.10.0' blockedBy 'ndx 0.9.0', both release epics: after the build the 0.10.0 change carries no blockedBy, so its work is selectable before 0.9.0's. On this repository the 0.7.1 and 0.8.0 epics lose 5 and 6 release acceptance criteria and their descriptions. The dry run reports '5 dissolved release … 0 droppedMeta'. This contradicts the first-pass rule 'The migration drops or cancels nothing'.\n\nFix (kept minimal, per Ryan 2026-10-12: low v1 adoption, no elaborate support machinery): write each container's description and acceptance criteria under its line in the cut change's body, and repoint the container's own blockedBy onto its children with the existing fde93c35 repoint. Tags, priority and extra dry-run reporting are out of scope."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-16T19:37:13.310Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
