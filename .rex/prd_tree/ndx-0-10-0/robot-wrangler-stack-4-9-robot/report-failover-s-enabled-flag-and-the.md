---
id: "31a45bcf-7451-4712-9f74-d5f784403074"
level: "task"
title: "Report failover's enabled flag and the full chain even when failover cannot fire"
status: "pending"
priority: "high"
tags:
  - "0.10.0"
  - "robot-wrangler-redesign"
  - "rw-stack-4"
source: "claude-code: Robot Wrangler redesign session 2026-10-11 (PR stack) — live API check of PR 4 found failover.enabled null and an empty chain on Claude CLI"
acceptanceCriteria:
  - "`failover.enabled` is a boolean on every response: false when `llm.autoFailover` is unset, true when it is set to true."
  - "For claude + cli, codex and google, `failover.chain` starts with the effective model and lists the following failover models, while `applies` stays false with the same reason."
  - "For claude + api, `applies` is true and the chain is unchanged; for local, the chain is empty."
  - "The Codex, Gemini and local reasons read grammatically and consistently."
  - "`routes-llm-failover.test.ts` covers each of the above; `pnpm --filter @n-dx/web test`, the package typecheck, and the root affected test gate pass."
description: "A live check of `GET /api/llm/config` on this branch showed the `failover` block falls short of its spec in two ways. Both come from `buildFailoverInfo` in `packages/web/src/server/routes-llm.ts` (added in 69b2b541e):\n\n1. **`enabled` is missing**, so the field reads as `null`. Set `enabled: boolean` from `llm.autoFailover`, false when unset, on every return path. Add it to the `FailoverInfo` type.\n2. **`chain` is empty whenever failover cannot apply.** The Robot Wrangler page shows the chain dimmed with the reason, so it needs the chain even when `applies` is false. For every vendor `getNextFailoverAttempt` supports (claude, codex, google), build the chain the same way the Claude-on-API path does: the effective model, then the models for attempts 1-3, stopping at exhaustion. Keep `applies` and `reason` exactly as they are. Local keeps an empty chain.\n\nAlso fix the Codex reason's grammar, \"Only Claude API support failover.\" Make all three non-Claude reasons read the same way, for example \"Failover is not available for Codex. Only Claude on the API connection supports failover.\"\n\nUpdate `packages/web/tests/unit/server/routes-llm-failover.test.ts` to cover each change."
lastModified: "2026-10-11T04:39:26.873Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
