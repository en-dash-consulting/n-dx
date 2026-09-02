---
id: "8af51591-962f-4e41-83a6-41dc3bb09cf5"
level: "task"
title: "Clone-detect and consolidate duplicate utility functions across hench, rex, and web packages"
status: "completed"
priority: "high"
tags:
  - "deduplication"
  - "refactor"
  - "architecture"
source: "smart-add"
startedAt: "2026-05-26T01:11:46.505Z"
completedAt: "2026-05-26T01:42:10.604Z"
endedAt: "2026-05-26T01:42:10.604Z"
acceptanceCriteria:
  - "No functionally identical function body appears in more than one package's production source"
  - "All consolidated functions reside in the tier-appropriate module per the hierarchy in CLAUDE.md"
  - "All former duplicate call sites import from the canonical location, passing through the correct gateway module"
  - "pnpm build and pnpm test pass after every consolidation step"
  - "Net line reduction is at least 120 lines"
description: "Run a code-clone detector (jscpd or similar) over production source files to surface function-level duplicates across package boundaries. For each confirmed duplicate group, select the canonical home per the four-tier hierarchy (Foundation → Domain → Execution → Orchestration), move the implementation there, and update all call sites to import from the canonical location through the appropriate gateway module. Verify build and tests pass after each consolidation."
---
