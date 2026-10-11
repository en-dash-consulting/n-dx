---
id: "45ad9e5b-c825-46b0-bf17-e074f5110b9e"
level: "task"
title: "Describe whether failover can fire from GET /api/llm/config"
status: "completed"
priority: "medium"
tags:
  - "0.10.0"
  - "robot-wrangler-redesign"
  - "rw-stack-4"
source: "claude-code: Robot Wrangler redesign session 2026-10-10 (PR stack)"
startedAt: "2026-10-11T02:27:07.072Z"
completedAt: "2026-10-11T02:38:41.808Z"
endedAt: "2026-10-11T02:38:41.808Z"
acceptanceCriteria:
  - "For claude + api, `applies` is true and `chain` has 4 entries starting with the effective model."
  - "For claude + cli, codex and google, `applies` is false with a reason."
  - "For local, `chain` is empty."
  - "`pnpm --filter @n-dx/web test` and the package typecheck pass."
description: "Add `failover: { enabled: boolean, applies: boolean, reason?: string, chain: string[] }` to `GET /api/llm/config`.\n\n- `chain` is the effective model followed by the models llm-client's `getNextFailoverAttempt` returns for attempts 1-3.\n- `applies` is true only when the run would actually use failover: today that is Claude on the API provider, because hench's `callWithFailover` lives in the Anthropic API loop; the CLI loops and the Gemini loop do not fail over.\n- When `applies` is false, `reason` is a sentence the page shows as-is, for example \"Failover only runs when Claude uses the API connection. With Claude CLI this switch has no effect.\" Local has an empty chain."
lastModified: "2026-10-11T02:38:42.055Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
