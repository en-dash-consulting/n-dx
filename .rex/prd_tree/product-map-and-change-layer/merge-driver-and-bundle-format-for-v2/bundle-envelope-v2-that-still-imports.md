---
id: "f0d39c6d-54ee-496f-8225-9ee9be3f3b3c"
level: "task"
title: "Bundle envelope v2 that still imports v1 bundles"
status: "pending"
priority: "medium"
tags:
  - "pr-15"
  - "lane-rex-store"
  - "rex"
  - "core"
source: "roadmap"
acceptanceCriteria:
  - "v2 round-trips export then import"
  - "A v1 bundle imports into a v2 tree"
description: "ndx prd export writes envelope v2 with both layers; import accepts v1 and v2.\n\n## Operator note (lane constraints for this run)\n\n- Do not edit anything under packages/rex/src/core/ (PRs 10 and 11 are open there), packages/rex/src/schema/v2.ts or packages/rex/src/schema/v2-rules.ts. Importing from them is fine. This feature's lane is rex-store: put new modules in packages/rex/src/store/ and wire commands in packages/rex/src/cli/.\n- Where the design doc and main's code disagree, main wins: schema/v2.ts and v2-rules.ts (PR 30, #580) are the authority. appliedIn is retired (appliedAt plus a computed apply commit); specReviewed is replaced by reviewedHash; a change's commits come from N-DX-Item trailers and are never stored.\n- If the task cannot be done without changing schema/v2.ts, do not change it: mark the task failing with the options in the resolution and stop.\n- The behaviour shipped here freezes at 1.0.0, so keep it small, explicit and tested.\n- Bundle: the v1 export/import lives in packages/rex/src/core/prd-bundle.ts, which this run must not edit. Build envelope v2 in packages/rex/src/store/ and dispatch on the envelope version in the export and import-bundle commands; import keeps accepting v1. Keep the bundle carve-out: export refuses any output path inside the rex directory."
lastModified: "2026-10-06T04:17:50.175Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
