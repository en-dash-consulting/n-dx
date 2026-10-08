---
id: "b623224f-02ef-455a-99ca-6cc886cdb580"
level: "feature"
title: "Run record carries the n-dx version and CLI path that produced it"
status: "completed"
priority: "high"
tags:
  - "pr-02"
  - "hench"
source: "parallel-development roadmap, 2026-09-10 discovery session"
startedAt: "2026-09-11T12:11:53.186Z"
completedAt: "2026-09-11T12:19:54.351Z"
endedAt: "2026-09-11T12:19:54.351Z"
acceptanceCriteria:
  - "New run records include ndxVersion and cliPath; legacy records without them still load."
  - "The run detail panel renders both when present."
description: "Add optional ndxVersion and cliPath to RunRecord (packages/hench/src/schema/v1.ts) and populate them in saveRun / run creation: version from @n-dx/hench package.json (or NDX_VERSION if the orchestrator exports one), cliPath from process.env.NDX_CLI_PATH ?? N_DX_CLI_PATH ?? process.argv[1]. Additive; the dashboard's run detail (packages/web/src/viewer/views/hench-runs.ts) shows them in the metadata block when present. This is what lets several active checkouts be told apart in token and outcome reports."
commits:
  - {"hash":"94dc3bb9b2e7e82b3d13e73059e43a78f69e30a9","author":"ryrykeith","authorEmail":"109387558+ryrykeith@users.noreply.github.com","timestamp":"2026-09-11T17:27:39-04:00"}
  - {"hash":"ab8dccd9fadf527a84085f079b245dbdb2dc8ce2","author":"ryrykeith","authorEmail":"109387558+ryrykeith@users.noreply.github.com","timestamp":"2026-09-11T15:13:33-07:00"}
  - {"hash":"25d7aa662c414e831fc41dbfc259db94782e0bda","author":"ryrykeith","authorEmail":"109387558+ryrykeith@users.noreply.github.com","timestamp":"2026-09-11T23:59:49-04:00"}
lastModified: "2026-09-11T12:19:54.360Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
