---
id: "e15d326f-777c-417d-9437-631e2c6638f9"
level: "task"
title: "Fix code in sourcevision-analyzers: The sourcevision-analyzers zone is a degenerate 2-file zone containing only dead (+1 more)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-04-14T01:20:13.352Z"
completedAt: "2026-04-14T01:21:33.284Z"
acceptanceCriteria: []
description: "- The sourcevision-analyzers zone is a degenerate 2-file zone containing only dead code (completion-reader.ts with zero production importers) and its own test. This zone will persist indefinitely unless a binary decision is made: delete both files if the module is abandoned, or add completion-reader to public.ts and wire it into the production pipeline if the export is intentional. Leaving the zone as-is gives sourcevision a misleading test coverage signal for a module with no callers.\n- Four enrichment passes have documented completion-reader.ts as dead code (zero production importers confirmed) with no deletion decision made. The sourcevision-analyzers zone will persist indefinitely as a 2-file satellite in zone reports, creating a false coverage signal. If no decision is made to wire it into the production pipeline (add to public.ts), schedule deletion of both completion-reader.ts and completion-reader.test.ts in the next dead-code cleanup PR."
recommendationMeta: "[object Object]"
---

# Fix code in sourcevision-analyzers: The sourcevision-analyzers zone is a degenerate 2-file zone containing only dead (+1 more)

🟠 [completed]

## Summary

- The sourcevision-analyzers zone is a degenerate 2-file zone containing only dead code (completion-reader.ts with zero production importers) and its own test. This zone will persist indefinitely unless a binary decision is made: delete both files if the module is abandoned, or add completion-reader to public.ts and wire it into the production pipeline if the export is intentional. Leaving the zone as-is gives sourcevision a misleading test coverage signal for a module with no callers.
- Four enrichment passes have documented completion-reader.ts as dead code (zero production importers confirmed) with no deletion decision made. The sourcevision-analyzers zone will persist indefinitely as a 2-file satellite in zone reports, creating a false coverage signal. If no decision is made to wire it into the production pipeline (add to public.ts), schedule deletion of both completion-reader.ts and completion-reader.test.ts in the next dead-code cleanup PR.

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-04-14T01:20:13.352Z
- **Completed:** 2026-04-14T01:21:33.284Z
- **Duration:** 1m
