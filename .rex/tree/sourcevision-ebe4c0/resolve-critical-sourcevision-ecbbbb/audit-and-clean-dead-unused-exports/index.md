---
id: "b6af7300-9330-4523-97fc-119ea106a002"
level: "task"
title: "Audit and clean dead/unused exports"
status: "completed"
priority: "high"
startedAt: "2026-02-11T17:04:34.658Z"
completedAt: "2026-02-11T17:04:34.658Z"
acceptanceCriteria:
  - "Re-analysis shows no legitimate unused-export findings (excluding class methods and dynamically-used components)"
  - "sourcevision analyze reports 0 circular dependency chains in imports.json"
description: "Audit modules flagged for unused exports. For each, either remove genuinely dead code, internalize module-private helpers, or confirm the export is needed and document why.\n\n---\n\nEliminate the 2 circular dependency chains between tree.ts ↔ delete.ts and tree.ts ↔ stats.ts caused by backward-compatibility re-exports."
---

# Audit and clean dead/unused exports

🟠 [completed]

## Summary

Audit modules flagged for unused exports. For each, either remove genuinely dead code, internalize module-private helpers, or confirm the export is needed and document why.

---

Eliminate the 2 circular dependency chains between tree.ts ↔ delete.ts and tree.ts ↔ stats.ts caused by backward-compatibility re-exports.

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-02-11T17:04:34.658Z
- **Completed:** 2026-02-11T17:04:34.658Z
- **Duration:** < 1m
