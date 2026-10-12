---
id: "61fa63ff-1c9c-4beb-9a11-ceacb0fd5c1e"
level: "task"
title: "Add POST /api/llm/config/preview, which resolves unsaved edits without writing them"
status: "completed"
priority: "medium"
tags:
  - "0.10.0"
  - "robot-wrangler-redesign"
  - "rw-stack-4"
blockedBy:
  - "8986a809-6174-413f-a1a5-fdd14cd6fb76"
  - "45ad9e5b-c825-46b0-bf17-e074f5110b9e"
  - "2c7d8e17-2fe7-4352-bfe5-2df086c54e3c"
source: "claude-code: Robot Wrangler redesign session 2026-10-10 (PR stack)"
startedAt: "2026-10-11T04:22:11.354Z"
completedAt: "2026-10-11T04:33:48.899Z"
endedAt: "2026-10-11T04:33:48.899Z"
resolutionType: "code-change"
resolutionDetail: "Added POST /api/llm/config/preview; GET and preview share one snapshot resolver; PUT and preview share validateLlmChange/applyLlmChange; llm-client exports parseLLMConfig."
acceptanceCriteria:
  - "POST with a vendor change returns the effective block for the new vendor while .n-dx.json and .hench/config.json are byte-identical before and after (test hashes them)."
  - "GET and preview produce identical output for an empty edit body."
  - "A foreign Origin is refused like any other POST."
  - "`pnpm --filter @n-dx/web test` and the package typecheck pass."
description: "Add `POST /api/llm/config/preview`. It takes the same body as `PUT /api/llm/config` (plus the hench provider field the page saves through `/api/hench/config`) and returns `effective`, `effectiveProblems`, `tiers`, `failover` and `review` for the saved configuration merged in memory with those edits, writing nothing.\n\n- Refactor so GET and preview share one resolution function over an in-memory config, rather than re-reading files with edits patched in afterwards.\n- Apply the same validation as PUT: invalid edits come back as problems, not 500s.\n- The route resolves its project from the request's workspace context (`ctx`), like every other route.\n- It goes through the request gate (Host, then Origin), because it is a mutation-shaped POST even though it writes nothing."
lastModified: "2026-10-11T04:33:49.209Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
