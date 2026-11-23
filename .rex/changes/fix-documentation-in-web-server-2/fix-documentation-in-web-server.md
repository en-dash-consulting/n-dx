---
id: "4c31ebc0-15a1-487b-b3c7-01b6f2005c25"
type: "task"
title: "Fix documentation in web-server: packages/web/src/server/ contains two *types.ts files with opposite runtime cont (+1 more)"
slug: "fix-documentation-in-web-server"
description: "- packages/web/src/server/ contains two *types.ts files with opposite runtime contracts in the same zone: shared-types.ts (explicitly documented 'Types only — no runtime code') and types.ts (exports jsonResponse, errorResponse, readBody runtime utilities). Rename types.ts to http-utils.ts or response-helpers.ts to eliminate the false pure-type signal and align with the monorepo-wide *types.ts = pure-type convention enforced by documentation in shared-types.ts.\n- routes-rex/shared.ts and server/shared-types.ts both use 'shared' in their names for different structural purposes (route-level utilities vs. cross-zone type bridge). Before routes-rex/ is formally governed as an internal sub-zone, rename routes-rex/shared.ts to routes-rex/rex-route-helpers.ts or similar to eliminate the naming collision."
priority: "high"
source: "sourcevision"
---
