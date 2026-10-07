---
id: "c5443dbd-7fa3-4ce8-b04d-f125cc6ef449"
level: "task"
title: "Handle direct map edits: editorial re-stamp or revised with a drafted change"
status: "completed"
priority: "high"
tags:
  - "pr-10"
  - "lane-rex-domain"
  - "rex"
blockedBy:
  - "17a8312b-14b6-45c8-8908-a51dad483249"
source: "roadmap"
startedAt: "2026-10-07T23:11:49.903Z"
completedAt: "2026-10-07T23:20:51.838Z"
endedAt: "2026-10-07T23:20:51.838Z"
resolutionType: "code-change"
resolutionDetail: "New packages/rex/src/core/map-edit.ts: handleMapEdit(tree, nodeRef, before, {editorial, summary, now, newId}). Editorial re-stamps metAt + History line; substantive keeps metAt, stamps revisedAt, drafts one Inbox change (source map-edit, needsPlacement) whose apply makes the node met at the edited spec. Tests in tests/unit/core/map-edit.test.ts."
acceptanceCriteria:
  - "Editorial edit keeps status met (test)"
  - "Substantive edit yields revised plus one drafted change with source map-edit (test)"
description: "An edit marked editorial re-stamps metAt and records a History line. Any other edit to statement or criteria leaves the capability revised and drafts a change in the Inbox from the intent diff."
lastModified: "2026-10-07T23:20:52.568Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
