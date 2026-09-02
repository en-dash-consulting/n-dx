---
id: "dd478339-ddfe-4ec9-bbe4-857f91e8ea64"
level: "task"
title: "Apply production-scoped cleanup transformations with test-exclusion hard guard"
status: "completed"
priority: "medium"
tags:
  - "self-heal"
  - "cleanup"
  - "transformation"
  - "safety"
source: "smart-add"
startedAt: "2026-04-14T19:48:11.509Z"
completedAt: "2026-04-14T20:05:39.228Z"
acceptanceCriteria:
  - "Removes dead exports confirmed by the analyzer with zero cross-package consumers"
  - "Prunes unused import statements from production source files"
  - "Consolidates duplicated utility functions when all callers can be updated atomically in the same pass"
  - "Throws a hard error and halts immediately if a write would target any file under tests/, *.test.ts, or *.spec.ts"
  - "Runs tsc --noEmit after each transformation batch; rolls back the entire batch on any type error"
  - "Each transformation is logged with file, line range, and change type in the run artifact"
  - "Transformation pass is idempotent — re-running on an already-clean codebase produces no changes"
description: "Execute safe automated cleanup transformations on production source files identified by the analyzer: remove dead exports with zero cross-package consumers, prune unused imports, and consolidate trivially duplicated utilities where both callers can be updated atomically. After each transformation batch, run tsc --noEmit to confirm no type errors; roll back the batch on failure. A hard guard must throw and halt if any write would touch a test file."
---
