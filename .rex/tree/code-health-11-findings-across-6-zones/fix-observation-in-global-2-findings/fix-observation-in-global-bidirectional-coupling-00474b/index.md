---
id: "00474be0-22fb-4ea1-802c-f5770696f29a"
level: "task"
title: "Fix observation in global: Bidirectional coupling: \"hench\" ↔ \"hench-cli-errors\" (6+5 crossings) — consider  (+1 more)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-04-20T15:40:01.374Z"
completedAt: "2026-04-20T15:44:55.292Z"
resolutionType: "code-change"
resolutionDetail: "Detached hench CLI error handling from prd/llm-gateway by importing foundation error primitives directly from @n-dx/llm-client, and added a boundary test to keep cli/errors.ts out of prd/."
acceptanceCriteria: []
description: "- Bidirectional coupling: \"hench\" ↔ \"hench-cli-errors\" (6+5 crossings) — consider extracting shared interface\n- Bidirectional coupling: \"web-shared\" ↔ \"web-viewer\" (1+11 crossings) — consider extracting shared interface"
recommendationMeta: "[object Object]"
---

# Fix observation in global: Bidirectional coupling: "hench" ↔ "hench-cli-errors" (6+5 crossings) — consider  (+1 more)

🟠 [completed]

## Summary

- Bidirectional coupling: "hench" ↔ "hench-cli-errors" (6+5 crossings) — consider extracting shared interface
- Bidirectional coupling: "web-shared" ↔ "web-viewer" (1+11 crossings) — consider extracting shared interface

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-04-20T15:40:01.374Z
- **Completed:** 2026-04-20T15:44:55.292Z
- **Duration:** 4m
