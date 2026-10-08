---
id: "5ee70ad3-313d-46f0-b99c-592d5e49dc74"
level: "task"
title: "Write the item id as the N-DX-Item trailer value"
status: "completed"
priority: "medium"
tags:
  - "pr-05"
  - "lane-hench"
  - "hench"
  - "core"
source: "roadmap"
startedAt: "2026-10-08T19:16:15.548Z"
completedAt: "2026-10-08T19:30:01.362Z"
endedAt: "2026-10-08T19:30:01.362Z"
resolutionType: "code-change"
resolutionDetail: "hench writes N-DX-Item: <item id> instead of a dashboard permalink; the web.publicUrl config read is gone. Parsers already accepted both forms (itemIdFromTrailer), with tests; docs in core/commit-trailers.js, SKILLS.md, rex README and CONTRIBUTING updated."
acceptanceCriteria:
  - "New hench commits carry N-DX-Item: <item id>"
  - "Parsers accept both the id and the legacy URL form (tests)"
description: "Change hench/src/agent/lifecycle/shared.ts (the trailer append near the publicUrl build) and core/commit-trailers.js so N-DX-Item carries the item id. Readers (backfill-commit-attribution and any parser) accept both the new id form and the old URL form."
commits:
  - {"hash":"cc050408bc1a173b5091ad9b0eecf72ffeb3c121","author":"Sterling H","authorEmail":"sterling.h@endash.us","timestamp":"2026-10-08T12:23:03-07:00"}
lastModified: "2026-10-08T19:30:01.911Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
