---
id: "f1a1314d-9dd3-4be6-9ff1-ca45c5c303c6"
level: "task"
title: "Report each vendor's readiness from GET /api/llm/catalog"
status: "completed"
priority: "medium"
tags:
  - "0.10.0"
  - "robot-wrangler-redesign"
  - "rw-stack-4"
source: "claude-code: Robot Wrangler redesign session 2026-10-10 (PR stack)"
startedAt: "2026-10-11T01:43:52.831Z"
completedAt: "2026-10-11T01:49:36.967Z"
endedAt: "2026-10-11T01:49:36.967Z"
acceptanceCriteria:
  - "Each vendor's catalog entry carries `readiness` with a state and summary, covered by unit tests for each vendor and state."
  - "No key value appears in the response (test asserts on a fixture key)."
  - "`pnpm --filter @n-dx/web test` and the package typecheck pass."
description: "Add `readiness` to each vendor's entry in `GET /api/llm/catalog`: `{ state: \"ready\" | \"needs-setup\" | \"unreachable\", summary: string, apiKey?: boolean }`, judged for the provider that vendor would run with:\n\n- Claude on CLI: ready when the CLI is found. Summary like \"Ready · CLI 2.1.286\".\n- Claude on API: ready when an API key resolves (`resolveApiKey`).\n- Codex: ready when the CLI is found. Codex has no API provider.\n- Gemini: ready when `resolveGoogleApiKey` finds a key.\n- Local: ready when the configured server answers; otherwise `unreachable`.\n\nThe summary is a short line the vendor card shows as-is (\"CLI not found\", \"API key missing\", \"Not reachable · localhost:1234\"). `apiKey` reports only presence: never return, log or echo a key value or its length."
lastModified: "2026-10-11T01:49:37.223Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
