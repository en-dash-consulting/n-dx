---
id: "e985fe67-805b-4070-8fb6-2a6f6f4abc9c"
level: "feature"
title: "Fix documentation in web-server (2 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-04-14T02:06:00.698Z"
completedAt: "2026-04-14T02:06:00.698Z"
acceptanceCriteria: []
description: "- packages/web/src/server/ contains two *types.ts files with opposite runtime contracts in the same zone: shared-types.ts (explicitly documented 'Types only — no runtime code') and types.ts (exports jsonResponse, errorResponse, readBody runtime utilities). Rename types.ts to http-utils.ts or response-helpers.ts to eliminate the false pure-type signal and align with the monorepo-wide *types.ts = pure-type convention enforced by documentation in shared-types.ts.\n- routes-rex/shared.ts and server/shared-types.ts both use 'shared' in their names for different structural purposes (route-level utilities vs. cross-zone type bridge). Before routes-rex/ is formally governed as an internal sub-zone, rename routes-rex/shared.ts to routes-rex/rex-route-helpers.ts or similar to eliminate the naming collision."
recommendationMeta: "[object Object]"
---

## Children

| Title | Status |
|-------|--------|
| [Fix documentation in web-server: packages/web/src/server/ contains two *types.ts files with opposite runtime cont (+1 more)](./fix-documentation-in-web-server-4c31eb.md) | completed |
