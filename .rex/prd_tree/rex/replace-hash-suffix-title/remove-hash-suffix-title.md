---
id: "b5924bd0-ca39-4052-a20a-6f2195fed052"
level: "task"
title: "Remove hash-suffix title disambiguation from rex add and reshape write paths"
status: "completed"
priority: "high"
tags:
  - "rex"
  - "prd-storage"
  - "reshape"
source: "smart-add"
startedAt: "2026-05-14T18:25:45.218Z"
completedAt: "2026-05-14T18:43:45.761Z"
endedAt: "2026-05-14T18:43:45.761Z"
resolutionType: "code-change"
resolutionDetail: "Audited the full write pipeline (cmdAdd, runScopedConsolidationPass, store addItem, MCP handleAddItem, smart-add acceptProposals, extract.ts). No suffix-generation helper for titles exists — the behavior is already correct. Added two regression tests in add-auto-reshape.test.ts to enforce this invariant: (1) adding an exact-duplicate title triggers merge with no hash suffix on the survivor, (2) bulk multi-title duplicates all resolve via merge with no suffix. The existing hash-suffix consolidation detection (stripHashSuffix, detectHashSuffixDuplicates, detectHashSuffixDuplicatesInTree) remains intact for legacy data cleanup."
acceptanceCriteria:
  - "rex add and ndx add never produce a title containing a generated hash/id suffix when a duplicate title is encountered"
  - "No code path in the write pipeline calls the suffix-generation helper for new items"
  - "Existing hash-suffix consolidation detection in reshape continues to function for legacy data"
  - "Regression test asserts that adding a duplicate-titled item triggers rename-or-merge resolution rather than suffix generation"
description: "Locate and remove the code path that appends a hash/id suffix to a new item's title when a sibling with the same title already exists. This includes the add pipeline, smart-add, and any reshape pass that generates suffixed titles. The hash-suffix consolidation detector (which identifies *existing* suffixed duplicates for cleanup) must remain — only the *creation* of new suffixed titles is being eliminated."
---
