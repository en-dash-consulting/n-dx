---
id: "4c31ebc0-15a1-487b-b3c7-01b6f2005c25"
level: "task"
title: "Fix documentation in web-server: packages/web/src/server/ contains two *types.ts files with opposite runtime cont (+1 more)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-04-14T02:03:28.821Z"
completedAt: "2026-04-14T02:06:00.524Z"
acceptanceCriteria: []
description: "- packages/web/src/server/ contains two *types.ts files with opposite runtime contracts in the same zone: shared-types.ts (explicitly documented 'Types only — no runtime code') and types.ts (exports jsonResponse, errorResponse, readBody runtime utilities). Rename types.ts to http-utils.ts or response-helpers.ts to eliminate the false pure-type signal and align with the monorepo-wide *types.ts = pure-type convention enforced by documentation in shared-types.ts.\n- routes-rex/shared.ts and server/shared-types.ts both use 'shared' in their names for different structural purposes (route-level utilities vs. cross-zone type bridge). Before routes-rex/ is formally governed as an internal sub-zone, rename routes-rex/shared.ts to routes-rex/rex-route-helpers.ts or similar to eliminate the naming collision."
recommendationMeta: "[object Object]"
---

# Fix documentation in web-server: packages/web/src/server/ contains two *types.ts files with opposite runtime cont (+1 more)

🟠 [completed]

## Summary

- packages/web/src/server/ contains two *types.ts files with opposite runtime contracts in the same zone: shared-types.ts (explicitly documented 'Types only — no runtime code') and types.ts (exports jsonResponse, errorResponse, readBody runtime utilities). Rename types.ts to http-utils.ts or response-helpers.ts to eliminate the false pure-type signal and align with the monorepo-wide *types.ts = pure-type convention enforced by documentation in shared-types.ts.
- routes-rex/shared.ts and server/shared-types.ts both use 'shared' in their names for different structural purposes (route-level utilities vs. cross-zone type bridge). Before routes-rex/ is formally governed as an internal sub-zone, rename routes-rex/shared.ts to routes-rex/rex-route-helpers.ts or similar to eliminate the naming collision.

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-04-14T02:03:28.821Z
- **Completed:** 2026-04-14T02:06:00.524Z
- **Duration:** 2m
