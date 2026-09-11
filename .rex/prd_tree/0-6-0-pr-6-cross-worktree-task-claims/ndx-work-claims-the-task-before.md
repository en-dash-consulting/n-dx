---
id: "a3e03e31-4abe-4039-a5e8-00cd94c183fd"
level: "task"
title: "ndx work claims the task before starting and releases on finish; get_next_task and hench selection skip live claims"
status: "pending"
priority: "high"
tags:
  - "pr-06"
  - "hench"
  - "rex"
blockedBy:
  - "67115804-a580-4b38-af7b-5b3629f20a06"
source: "parallel-development roadmap, 2026-09-10 discovery session"
acceptanceCriteria:
  - "Integration test with a temp repo and two worktrees: worktree A claims task T; `hench next` in worktree B returns the next unclaimed task."
  - "Claims are released on normal completion, failure and SIGINT."
  - "Dashboard execute returns 409 naming the claiming worktree."
description: "hench: in packages/hench/src/cli/commands/run.ts claim the selected task right after selection and before the pre-run gate (through the rex gateway, packages/hench/src/prd/rex-gateway.ts); release in the run finalization path including failure and cancellation. rex: get_next_task (MCP, packages/rex/src/cli/mcp-tools.ts) and the CLI next command pass over tasks claimed by another worktree, and report the skipped ids when --verbose. Selection inside the same worktree that holds the claim is allowed (retry after crash). A claim is informational for the dashboard's execute route too: routes-hench.ts returns 409 with the claiming worktree when a task is claimed elsewhere."
lastModified: "2026-09-10T20:12:05.724Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
