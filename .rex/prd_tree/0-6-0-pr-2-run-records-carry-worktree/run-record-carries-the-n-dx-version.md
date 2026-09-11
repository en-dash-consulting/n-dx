---
id: "b623224f-02ef-455a-99ca-6cc886cdb580"
level: "task"
title: "Run record carries the n-dx version and CLI path that produced it"
status: "pending"
priority: "high"
tags:
  - "pr-02"
  - "hench"
source: "parallel-development roadmap, 2026-09-10 discovery session"
acceptanceCriteria:
  - "New run records include ndxVersion and cliPath; legacy records without them still load."
  - "The run detail panel renders both when present."
description: "Add optional ndxVersion and cliPath to RunRecord (packages/hench/src/schema/v1.ts) and populate them in saveRun / run creation: version from @n-dx/hench package.json (or NDX_VERSION if the orchestrator exports one), cliPath from process.env.NDX_CLI_PATH ?? N_DX_CLI_PATH ?? process.argv[1]. Additive; the dashboard's run detail (packages/web/src/viewer/views/hench-runs.ts) shows them in the metadata block when present. This is what lets several active checkouts be told apart in token and outcome reports."
lastModified: "2026-09-10T20:11:39.063Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
