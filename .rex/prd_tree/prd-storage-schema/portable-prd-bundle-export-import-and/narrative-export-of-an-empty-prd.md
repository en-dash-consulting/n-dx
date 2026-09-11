---
id: "15a698a7-9319-4493-af88-e80e689e5ff7"
level: "task"
title: "Narrative export of an empty PRD claims \"everything on the plan is finished\""
status: "completed"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
startedAt: "2026-09-10T17:26:50.344Z"
completedAt: "2026-09-10T17:30:06.979Z"
endedAt: "2026-09-10T17:30:06.979Z"
resolutionType: "code-change"
resolutionDetail: "Empty-state message now reflects whether work was ever planned: empty/tombstone-only PRDs say no work is recorded yet, all-completed plans keep the finished phrasing, and scoped renders say \"this initiative\". Covered by four unit tests."
acceptanceCriteria:
  - "Narrative export of a PRD with zero items states that no work is recorded yet, and does not claim the plan is finished"
  - "The everything-finished phrasing still appears when items exist but all are completed and --include-completed is not passed"
  - "A unit test covers both the truly-empty and the all-completed documents"
description: "Verdict: should-fix (severity low). Found by adversarial review of the portable-PRD-bundle branch diff.\n\nFailure scenario: `renderNarrative` (packages/rex/src/core/prd-narrative.ts:361-366) chooses its empty-document message by `includeCompleted`, not by whether any items exist. On a freshly-initialised project with zero items (or one whose items are all deleted), `rex export --format=narrative` emits \"No open work is recorded for this project — everything on the plan is finished.\" Nothing was ever planned; a stakeholder reads \"all done.\" This is a silent wrong statement in exactly the document type built to be handed to a decision-maker.\n\nRelated cosmetic nit to fix in the same place: the message says \"for this project\" even when scoped to a single `--item`, where \"for this initiative\" (or the item's title) would be accurate.\n\nSolution: branch on \"the document had no items at all\" (render \"No work is recorded for this project yet.\") vs \"items existed but were all filtered out\" (keep the everything-finished phrasing). One condition plus a test."
lastModified: "2026-09-10T17:30:07.005Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
