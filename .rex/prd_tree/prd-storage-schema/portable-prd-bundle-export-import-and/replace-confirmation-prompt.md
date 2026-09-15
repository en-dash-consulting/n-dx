---
id: "af48d839-cc52-4b27-90e5-2f4225178023"
level: "task"
title: "--replace confirmation prompt undercounts the items it is about to destroy"
status: "completed"
priority: "medium"
tags:
  - "pr-review"
  - "severity:medium"
source: "pr-review"
startedAt: "2026-09-10T19:39:28.917Z"
completedAt: "2026-09-10T19:43:06.237Z"
endedAt: "2026-09-10T19:43:06.237Z"
resolutionType: "code-change"
resolutionDetail: "The --replace confirmation now quotes countItems(existing.items) rather than existing.items.length, matching the `replaced` count mergeBundle reports afterwards. 5 integration tests force isTTY and mock node:readline to assert the real prompt string through the real call path; verified red (2 failures) before the change and green after. Full suite clean, 6/6."
acceptanceCriteria:
  - "The replace prompt reports the full recursive item count via countItems"
  - "The prompted count matches the replaced count reported after a confirmed replace"
description: "Verdict: valid (verified). cmdImportBundle passes existing.items.length — the top-level count — to confirmReplace (import-bundle.ts:143), while the post-import report uses countItems over the whole tree. A PRD of 3 epics holding 240 descendants prompts \"Replace the existing PRD (3 items)?\" and then reports \"Replaced 240 items\". This is the only interactive guard on an irreversible whole-PRD wipe (see the companion snapshot task) and it understates the loss.\n\nSolution: one line — confirmReplace(countItems(existing.items)). countItems is already exported from prd-bundle.ts and used in export.ts for exactly this."
lastModified: "2026-09-10T19:43:06.243Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
