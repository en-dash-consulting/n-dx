---
id: "d2a70fe9-3e21-41a6-aca5-7ea4c47e1ac8"
level: "task"
title: "Address anti-pattern issues (2 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-06T18:14:50.750Z"
completedAt: "2026-03-06T18:21:32.613Z"
acceptanceCriteria: []
description: "- God function: main in packages/rex/src/cli/index.ts calls 48 unique functions — consider decomposing into smaller, focused functions\n- God function: usePRDActions in packages/web/src/viewer/hooks/use-prd-actions.ts calls 39 unique functions — consider decomposing into smaller, focused functions"
recommendationMeta: "[object Object]"
---

# Address anti-pattern issues (2 findings)

🟠 [completed]

## Summary

- God function: main in packages/rex/src/cli/index.ts calls 48 unique functions — consider decomposing into smaller, focused functions
- God function: usePRDActions in packages/web/src/viewer/hooks/use-prd-actions.ts calls 39 unique functions — consider decomposing into smaller, focused functions

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-03-06T18:14:50.750Z
- **Completed:** 2026-03-06T18:21:32.613Z
- **Duration:** 6m
