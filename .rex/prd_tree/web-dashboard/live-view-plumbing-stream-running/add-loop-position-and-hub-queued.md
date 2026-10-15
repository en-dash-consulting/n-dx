---
id: "db56901f-a208-4d31-aad3-c6e4a88cea87"
level: "task"
title: "Add loop position and hub-queued execute requests to GET /api/live"
status: "completed"
priority: "medium"
tags:
  - "live"
  - "web-server"
startedAt: "2026-10-14T20:29:25.670Z"
completedAt: "2026-10-14T20:58:11.277Z"
endedAt: "2026-10-14T20:58:11.277Z"
resolutionType: "code-change"
resolutionDetail: "hench records RunRecord.loop {mode, iteration, max?} at run start from the three loop drivers; routes-worktrees digests it and GET /api/live exposes it as runs[].loop. Queued execute requests ride the existing hub admission header, narrowed to the proxied project, and are laid over the cached snapshot as queue.queued — no extra I/O."
acceptanceCriteria:
  - "Each running LiveRun started by a loop reports its position in the loop"
  - "GET /api/live lists the execute requests the hub has queued for this project, and the request stays under 100 ms because it reads cached data"
description: "`GET /api/live` (packages/web/src/server/routes-live.ts) omits two parts of its brief because the data does not reach the project server. (1) Loop position: hench records nothing about where a `--loop`/`--auto`/`--epic-by-epic` run is in its chain (no field on RunRecord in packages/hench/src/schema/v1.ts). Add one, written at iteration start, e.g. `loop: { mode, iteration, max? }`, then read it in `digestRun` (routes-worktrees.ts) and expose it on LiveRun. (2) Queued execute requests: the hub's admission queue (packages/web/src/hub/admission.ts) lives in the hub process; the viewer polls `/api/hub/queue` itself. The project server does not know the hub's port or its own project id. Options: the hub passes `NDX_HUB_PORT` and `NDX_HUB_PROJECT_ID` to the children it spawns, and routes-live probes `/api/hub/queue` in the background with a cache so the request stays fast; or the viewer merges the two answers. Pick one, then fill `queue.queued`."
assignee: "Sterling H <sterling.h@endash.us>"
lastModified: "2026-10-14T20:58:11.837Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
