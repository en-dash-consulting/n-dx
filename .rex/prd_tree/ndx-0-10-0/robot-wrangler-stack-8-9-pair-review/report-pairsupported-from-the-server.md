---
id: "2fb0c11f-b6fe-4f62-acb6-f86b94ad2bda"
level: "task"
title: "Report pairSupported from the server, document the review modes, and add the changesets"
status: "pending"
priority: "medium"
tags:
  - "0.10.0"
  - "robot-wrangler-redesign"
  - "rw-stack-8"
blockedBy:
  - "63f5fbf5-5991-4b9b-b1e2-dee981be4d4c"
  - "2c7d8e17-2fe7-4352-bfe5-2df086c54e3c"
source: "claude-code: Robot Wrangler redesign session 2026-10-10 (PR stack)"
acceptanceCriteria:
  - "GET /api/llm/config reports pairSupported true and the Pair card is enabled."
  - "Docs describe the three modes and their settings."
  - "Patch changesets exist for @n-dx/hench, @n-dx/core and @n-dx/web."
  - "`pnpm --filter @n-dx/web test` and the package typecheck pass."
description: "Flip `review.pairSupported` in `GET /api/llm/config` to true, so Robot Wrangler enables the Pair card. Prefer deriving it from a capability hench exports through the existing contract surface over a bare constant, if one is available.\n\nDocument the three review modes:\n- what each does;\n- the settings (`hench.review.mode`, `.vendor` and `.rounds`, and `llm.<vendor>.reviewModel`);\n- that pair review needs a CLI on both sides;\n- how findings flow (must-fix back to the executor, lesser findings to the PRD).\n\nPut it in the user docs and in the package `AGENTS.md` where review is described.\n\nAdd patch changesets for `@n-dx/hench`, `@n-dx/core` and `@n-dx/web`."
lastModified: "2026-10-10T23:41:34.369Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
