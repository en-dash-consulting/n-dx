---
id: "b278c791-6f55-4dea-a8ff-87eda5818473"
type: "task"
title: "Keep writing .n-dx-web.port in the project directory pointing at the hub so refresh --live-server and the reload signal work unchanged"
slug: "keep-writing-n-dx-web-port-in-the"
description: "After registration, write <absDir>/.n-dx-web.port with the hub port and <absDir>/.n-dx-web.pid with { pid: hubPid, port, startedAt, via: \"hub\", projectId }. packages/core/cli.js's reload signal (POST /api/reload, ~line 875) then reaches the hub; the hub forwards to the right child (PR 8 root alias for a single project; otherwise match on the directory sent in the request body — add { dir } to the POST body). tests/e2e/cli-refresh.test.js must keep passing."
acceptanceCriteria:
  - "`ndx refresh --data-only --live-server` from a registered worktree triggers viewer:reload in that project's dashboard."
  - "cli-refresh e2e passes with and without the hub."
priority: "high"
tags:
  - "pr-10"
  - "core"
source: "parallel-development roadmap, 2026-09-10 discovery session"
blockedBy:
  - "3ef3366c-7d84-4f33-a0e0-3f9c3f368e61"
---
