---
id: "5629434c-af5a-4890-9296-f9d8e9f35f6e"
level: "task"
title: "Lay out the Local vendor: server profiles, connection test, live models and collapsed advanced settings"
status: "pending"
priority: "medium"
tags:
  - "0.10.0"
  - "robot-wrangler-redesign"
  - "rw-stack-6"
blockedBy:
  - "2d0c1a65-30e2-4345-970c-19cc973a4010"
source: "claude-code: Robot Wrangler redesign session 2026-10-10 (PR stack)"
acceptanceCriteria:
  - "Selecting Local shows profiles, host/port with Test connection, live models and the three collapsed advanced rows with their current values."
  - "Every local field the old page edited still saves to the same key."
  - "`pnpm --filter @n-dx/web test` and the package typecheck pass."
description: "When Local is selected, Section 2 becomes **\"Server\"** (subtitle \"Where your local models are served\"):\n- A row of profile chips from `/api/llm/local-profiles`: the selected one highlighted, plus \"+ Save current as profile\".\n- A card with Host and Port inputs and a \"Test connection\" button. The result line reads like \"Connected · 3 models · reply in 412 ms · 38 tok/s\", or the error.\n- The live status, which refreshes every 10s as today.\n\nSection 3's tier table uses the live model list: Primary is Standard; Light falls back to Primary.\n\nAdvanced settings move into collapsed `<details>` rows, each showing its current value in the summary: Context budget, Request timeout, Second-model verifier (host, port, model, max review cycles).\n\nEvery existing local field stays editable."
lastModified: "2026-10-10T23:41:07.296Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
