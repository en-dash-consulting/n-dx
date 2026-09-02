---
id: "484812ac-4ed8-4cfd-ae52-20509e3200fb"
level: "task"
title: "Merge duplicated test helper and fixture factories into per-package shared test utilities"
status: "completed"
priority: "medium"
tags:
  - "deduplication"
  - "testing"
  - "cleanup"
source: "smart-add"
startedAt: "2026-05-26T01:55:55.430Z"
completedAt: "2026-05-26T02:04:08.482Z"
endedAt: "2026-05-26T02:04:08.482Z"
resolutionType: "code-change"
resolutionDetail: "Created shared test utility modules for hench, rex, and sourcevision packages. Consolidated mockStore, envelope creators, and item builders. Eliminated 390 lines of duplicate code. Updated 12 test files to import from shared modules. Net 295-line code reduction. All tests pass."
acceptanceCriteria:
  - "No test helper function body is copy-pasted across more than one test file within the same package"
  - "Each package with duplicated helpers has a single shared test utility module that all consumers import from"
  - "pnpm test passes with identical pass/fail counts after consolidation"
  - "Net reduction in test code size is at least 80 lines across all packages"
description: "Audit test files within each package for helper functions, fixture builders, and mock setup blocks that are copy-pasted across multiple test files in the same package. Consolidate confirmed duplicates into a discoverable shared test utility module per package (e.g., tests/helpers/index.ts). Update all consumers to import from the shared module. This does not modify test assertions or production logic."
---
