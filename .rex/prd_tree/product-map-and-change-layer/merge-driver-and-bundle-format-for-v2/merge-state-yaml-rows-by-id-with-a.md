---
id: "ae195bab-197e-4384-a371-f3f75dd120b9"
level: "task"
title: "Merge state.yaml rows by id with a custom merge driver"
status: "in_progress"
priority: "medium"
tags:
  - "pr-15"
  - "lane-rex-store"
  - "rex"
  - "core"
source: "roadmap"
startedAt: "2026-10-08T06:48:37.407Z"
acceptanceCriteria:
  - "Concurrent child adds merge cleanly (test)"
  - "Conflicting metAt is recomputed (test)"
description: "Merge rows by id; where both sides changed metAt or status, recompute from intent rather than pick a side. Register the driver and line-ending pins through core/gitattributes-pins.js.\n\n## Operator note (lane constraints for this run)\n\n- Do not edit anything under packages/rex/src/core/ (PRs 10 and 11 are open there), packages/rex/src/schema/v2.ts or packages/rex/src/schema/v2-rules.ts. Importing from them is fine. This feature's lane is rex-store: put new modules in packages/rex/src/store/ and wire commands in packages/rex/src/cli/.\n- Where the design doc and main's code disagree, main wins: schema/v2.ts and v2-rules.ts (PR 30, #580) are the authority. appliedIn is retired (appliedAt plus a computed apply commit); specReviewed is replaced by reviewedHash; a change's commits come from N-DX-Item trailers and are never stored.\n- If the task cannot be done without changing schema/v2.ts, do not change it: mark the task failing with the options in the resolution and stop.\n- The behaviour shipped here freezes at 1.0.0, so keep it small, explicit and tested.\n- Merge driver: rows in state.yaml are keyed by item id (see store/state-writer.ts for the file contract; reuse its reader and canonical writer). Where both sides changed metAt or status, recompute rather than pick a side. metAt is a spec hash (specHash in schema/v2-rules.ts over the node's statement and criteria), so recompute it from the merged intent. Register the driver and the line-ending pins through packages/core/gitattributes-pins.js (as the rex-prd driver is), keeping n-dx's own .gitattributes in sync (tests/e2e/prd-line-endings.test.js guards that)."
lastModified: "2026-10-08T06:48:37.652Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
