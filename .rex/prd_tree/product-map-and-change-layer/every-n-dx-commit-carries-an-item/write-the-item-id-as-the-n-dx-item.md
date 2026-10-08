---
id: "5ee70ad3-313d-46f0-b99c-592d5e49dc74"
level: "task"
title: "Write the item id as the N-DX-Item trailer value"
status: "in_progress"
priority: "medium"
tags:
  - "pr-05"
  - "lane-hench"
  - "hench"
  - "core"
source: "roadmap"
startedAt: "2026-10-08T19:16:15.548Z"
acceptanceCriteria:
  - "New hench commits carry N-DX-Item: <item id>"
  - "Parsers accept both the id and the legacy URL form (tests)"
description: "Change hench/src/agent/lifecycle/shared.ts (the trailer append near the publicUrl build) and core/commit-trailers.js so N-DX-Item carries the item id. Readers (backfill-commit-attribution and any parser) accept both the new id form and the old URL form."
lastModified: "2026-10-08T19:16:16.050Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
