---
id: "f912174e-96e5-41a3-acd9-5c73bae27c5b"
type: "task"
title: "C8: auth and key messages are CLI-first and store-first"
slug: "c8-auth-and-key-messages-are-cli-first"
description: "PR 3. Re-ground before it runs, after T8 lands: T7 and T8 rewrite most of these strings, so the locations from the 2026-10-30 re-ground (llm-client auth.ts, openai-api-provider.ts, api-provider.ts, google-api-provider.ts, auth-guidance.ts; hench loop.ts and cli/errors.ts; core config.js and file-permissions.js; web routes-rex-analysis.ts) are a starting list, not line numbers to trust."
acceptanceCriteria:
  - "Every code string in 02-reground's text table is CLI-first or store-first, points at ndx config credentials.<vendor> rather than a key on argv, and says ndx rather than n-dx"
  - "Messages say that storing a key does not switch modes and llm.<vendor>.auth api does"
priority: "low"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "credential-injection-design"
blockedBy:
  - "94e25654-bb3c-4203-a1ab-49267e0ad734"
  - "10730d82-59f1-4ea2-9594-667318da70d2"
---
