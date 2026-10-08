---
"@n-dx/rex": patch
---

Add v2 work selection (`core/change-selection.ts`, not wired yet): picks placed changes and tasks, a task-less change being its own unit; orders by priority, then nearest `plannedRelease`, then dependency order. `needsPlacement` blocks autonomous selection only; `resolveWorkById` still returns it. `readyOnly` and `assignee` filters are opt-in.
