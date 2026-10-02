---
id: "70eb7e99-0376-4b5a-af41-1a4b4f52b6ac"
level: "task"
title: "Add the prep routes: GET /api/hench/prep/:taskId, POST /api/hench/prep/:taskId/preview and GET /api/hench/ready"
status: "pending"
priority: "high"
tags:
  - "0.8.0"
  - "task-prep"
  - "phase-1"
  - "web-server"
blockedBy:
  - "3e07628e-0eac-4693-a434-40feeb34ac65"
  - "ce8caaa2-05f0-4e69-b8fe-bf0b485f6709"
acceptanceCriteria:
  - "GET /api/hench/prep/:taskId returns the resolve JSON plus catalog, admission, workspace and recommendation:null, in the request's workspace; tests cover anchor and /w/<key>/."
  - "A failing or timed-out resolve answers 502 with the stderr tail, not a hung request."
  - "POST /api/hench/prep/:taskId/preview returns the dry-run brief for the given options and rejects invalid options with 400."
  - "GET /api/hench/ready returns tasks in findNextTask order, skips claimed tasks, and marks in-progress tasks with no live run as resume."
  - "Patch changeset for @n-dx/web."
description: "Server routes the Prepare task modal and the Ready to run list read. All three are workspace-scoped: resolve ctx from the /w/<key>/ slot or the X-Ndx-Workspace header like the other hench routes, and spawn in ctx.projectDir.\n\nGET /api/hench/prep/:taskId — spawn `ndx work --task=<id> --resolve <ctx.projectDir>` through resolveNdxBin (packages/web/src/server/routes-commands.ts:243; it uses NDX_CLI_PATH so the build matches the terminal's ndx) with a 15 s timeout, parse the JSON, and add: `catalog` (models and providers for the resolved vendor, from the GET /api/llm/catalog builder in llm-catalog.ts / routes-llm.ts), `admission` (when served through the hub, parse the HUB_ADMISSION_HEADER the proxy sends, as routes-live.ts:701 does: running, max, queued, availableBytes, pressure, memoryPaused — fields from #500), `workspace` (branch, isAnchor, dirty, and whether a run is live in this worktree, from listWorktrees / run liveness), and `recommendation: null` (reserved for a later phase). A resolve failure answers 502 with the stderr tail.\n\nPOST /api/hench/prep/:taskId/preview — body {options}; validate with the run-options allow-list from the execute task, spawn `ndx work --task=<id> --dry-run <flags> <dir>` (30 s timeout) and return {brief: <stdout>}. Dry runs observe claims read-only and write nothing, so this is safe to call repeatedly.\n\nGET /api/hench/ready?limit=N (default 10, max 50) — the next N tasks in the order `ndx work --auto` would pick them: call findNextTask (exported through packages/web/src/server/rex-gateway.ts:81) repeatedly, excluding each pick, skipping tasks another worktree has claimed the same way GET /api/rex/next does (routes-rex/reads.ts:205). In-progress tasks with no live run are included with `resume: true`. Each row: id, title, status, priority, level, parentChain (titles), criteriaCount, tags, resume, liveRun (bool)."
lastModified: "2026-10-02T04:55:14.364Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
