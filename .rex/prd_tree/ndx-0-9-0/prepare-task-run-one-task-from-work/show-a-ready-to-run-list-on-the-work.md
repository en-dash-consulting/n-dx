---
id: "3bac467a-aa69-46d0-867a-92ae044348c4"
level: "task"
title: "Show a Ready to run list on the Work page and hide the Epic-by-Epic panel"
status: "completed"
priority: "medium"
tags:
  - "0.8.0"
  - "task-prep"
  - "phase-1"
  - "web-viewer"
blockedBy:
  - "379bf324-8797-49ca-8eba-f83e370dacdd"
startedAt: "2026-10-02T06:58:11.371Z"
completedAt: "2026-10-02T07:09:13.462Z"
endedAt: "2026-10-02T07:09:13.462Z"
resolutionType: "code-change"
resolutionDetail: "Ready to run list on Work (components/ready-to-run.ts), Epic-by-Epic panel unmounted, patch changeset, tests."
acceptanceCriteria:
  - "The Work page shows Ready to run rows from /api/hench/ready in the order returned, with resume rows labelled."
  - "Prepare…/Resume… and the title open the modal for that task; Start now starts or queues with no options and shows the matching toast; Copy terminal command copies `ndx work --task=<id> --auto <dir>`."
  - "The list refreshes on run-changed and execution-progress frames."
  - "The Epic-by-Epic panel no longer renders anywhere; a test asserts it."
  - "Patch changeset for @n-dx/web."
description: "The Work stage page (views/view-registry.ts:132 → StagePage, which embeds the rex dashboard) says \"hand the next task to the agent, pick a run mode\", but its only trigger today is Epic-by-Epic.\n\nAdd a \"Ready to run\" section at the top of the Work page fed by GET /api/hench/ready?limit=10: one row per task with a status icon (pending, in progress), title, parent chain, priority, criteria count, \"in progress · no live run\" for resume rows, and a split button: primary \"Prepare…\" (\"Resume…\" for in-progress rows) opens the Prepare task modal; the menu has \"Start now\" (POST /api/hench/execute with no options; show a toast: started with a link to Live, queued with its position, or the refusal message) and \"Copy terminal command\". Clicking the title also opens the modal. Refresh on the `hench:run-changed` and `hench:task-execution-progress` WebSocket frames. Empty state: \"Nothing ready to run\" with a link to the PRD.\n\nHide the Epic-by-Epic panel (ExecutionPanel, mounted in views/rex-dashboard.ts:518): it calls `hench run` directly from the project's own build (routes-rex/execution.ts:128), so it fails outside the n-dx monorepo, reports a failed epic as completed (execution.ts:214), skips the hub queue and the throttle, and cannot be stopped from Live. Stop rendering it; leave the server route in place for now with a comment pointing at the planned Run queue panel."
lastModified: "2026-10-02T07:09:13.864Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
