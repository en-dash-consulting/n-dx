---
id: "962e9867-2ef4-41af-b729-5a396c374d49"
level: "task"
title: "Accept Heavy and Free tier model saves through PUT /api/llm/config"
status: "completed"
priority: "medium"
tags:
  - "0.10.0"
  - "robot-wrangler-redesign"
  - "rw-stack-4"
blockedBy:
  - "8986a809-6174-413f-a1a5-fdd14cd6fb76"
source: "claude-code: Robot Wrangler redesign session 2026-10-10 (PR stack)"
startedAt: "2026-10-11T04:07:14.695Z"
completedAt: "2026-10-11T04:17:31.155Z"
endedAt: "2026-10-11T04:17:31.155Z"
resolutionType: "code-change"
resolutionDetail: "Extended modelPathVendor to extract vendor from llm.tiers.* paths; modified validateRoutingChange to validate path structure only, deferring model compatibility validation to validateModelForVendor. Tier saves now accept Heavy and Free models with proper vendor validation."
acceptanceCriteria:
  - "Saving a heavy model for claude writes `llm.tiers.claude.heavy` to .n-dx.json, and the next GET reports it with that source."
  - "A Codex model id for the claude heavy tier is rejected with a message."
  - "Saving an empty value removes the key."
  - "`pnpm --filter @n-dx/web test` and the package typecheck pass."
description: "Let `PUT /api/llm/config` write `llm.tiers.<vendor>.heavy` and `llm.tiers.<vendor>.free` through the same config-write path the other `llm.*` fields use. Validate cloud-vendor values with llm-client's `isModelCompatibleWithVendor`; Local accepts any id. An empty value removes the key, so the tier falls back to its default. Standard and Light keep their current keys (`llm.<vendor>.model`, `llm.<vendor>.lightModel`), so nothing migrates."
lastModified: "2026-10-11T04:17:31.427Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
