---
id: "7ed4c848-e4be-4f6e-b495-5d70a9457fec"
level: "task"
title: "Inventory duplicated unit-test constants across suites"
status: "completed"
priority: "high"
tags:
  - "tests"
  - "unit"
  - "refactor"
  - "maintainability"
source: "smart-add"
startedAt: "2026-04-02T17:55:20.914Z"
completedAt: "2026-04-20T13:16:41.814Z"
resolutionType: "code-change"
resolutionDetail: "Created tests/unit-test-constant-inventory.md cataloging 6 constants in 4+ unit test files with file lists and consolidation recommendations."
acceptanceCriteria:
  - "A concrete inventory exists for duplicated constants used in more than four unit test files"
  - "The inventory excludes constants that are unique to a single suite or tightly coupled to one test file"
description: "Review unit test files to identify repeated constants that appear in more than four files and record where they are used so consolidation candidates are explicitly defined."
---
