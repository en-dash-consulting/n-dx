---
id: "40834f3a-3416-4a89-86f8-345c49cca586"
level: "task"
title: "Remove single-symbol re-export modules and collapse intermediate barrel indirection"
status: "in_progress"
priority: "medium"
tags:
  - "refactor"
  - "modules"
  - "cleanup"
source: "smart-add"
startedAt: "2026-05-26T02:12:24.122Z"
acceptanceCriteria:
  - "No module file exists whose entire content is a single re-export of one symbol from one other file"
  - "All barrel files that were removed have their consumers updated to import from the canonical source location"
  - "pnpm build and pnpm test pass after each removal"
  - "No new circular dependencies are introduced (verified by architecture-policy.test.js)"
  - "Net reduction is at least 5 files and 40 lines"
description: "Find barrel or index files that exist solely to re-export a single symbol from one other module, adding no aggregation, renaming, or additional exports. Update all consumers to import directly from the source module (or through the appropriate gateway), then delete the unnecessary intermediate file. Also collapse barrel files where every re-exported symbol is consumed by only one downstream file — replace the barrel import with a direct import in that file."
---
