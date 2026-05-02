---
id: "c4e93fb7-645d-495d-ade0-9bdff9cbb75c"
level: "feature"
title: "Fix anti-pattern in global (2 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-04-03T14:34:54.622Z"
completedAt: "2026-04-03T14:34:54.622Z"
acceptanceCriteria: []
description: "- God function: analyzeImports in packages/sourcevision/src/analyzers/imports.ts calls 41 unique functions — consider decomposing into smaller, focused functions\n- God function: runCI in packages/core/ci.js calls 39 unique functions — consider decomposing into smaller, focused functions"
recommendationMeta: "[object Object]"
---

# Fix anti-pattern in global (2 findings)

🟠 [completed]

## Summary

- God function: analyzeImports in packages/sourcevision/src/analyzers/imports.ts calls 41 unique functions — consider decomposing into smaller, focused functions
- God function: runCI in packages/core/ci.js calls 39 unique functions — consider decomposing into smaller, focused functions

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Fix anti-pattern in global: God function: analyzeImports in packages/sourcevision/src/analyzers/imports.ts c (+1 more) | task | completed | 2026-04-16 |

## Info

- **Status:** completed
- **Priority:** high
- **Level:** feature
- **Started:** 2026-04-03T14:34:54.622Z
- **Completed:** 2026-04-03T14:34:54.622Z
- **Duration:** < 1m
