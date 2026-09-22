---
id: "00c871e8-958f-4637-b5e8-72e1cb07979d"
level: "feature"
title: "Hench commit hygiene"
status: "pending"
priority: "medium"
tags:
  - "0.7.1"
  - "hench-commit-hygiene"
source: "caos work management: feature ndx 0.7.1 - Hench commit hygiene"
acceptanceCriteria:
  - "An unrelated dirty file under .rex/prd_tree/ is not included in a completion commit (integration test in the completion-metadata suite)."
  - "Existing pathspec behaviour for operator-staged work is retained."
  - "A real ndx work completion commit touches only the completed item's files and its parent's."
description: "When hench marks a task complete it commits PRD metadata by staging the whole .rex/prd_tree directory, which once swept a 1,378-file in-flight rename into a 'task completed' commit. The serializer already reports exactly which files it wrote and deleted. Make the completion commit stage that list, plus the tree metadata file, and nothing else, while keeping the existing behaviour for work the operator staged deliberately.\n\nGoal: A hench completion commit contains only the PRD files that the completion changed."
lastModified: "2026-09-21T17:24:06.456Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Expose the PRD serializer's written and deleted file list through the rex gateway](./expose-the-prd-serializer-s-written.md) | pending |
| [Filter gitignored paths out of the hench PRD staging list](./filter-gitignored-paths-out-of-the.md) | completed |
| [Keep a completed task completed when only the record commit fails](./keep-a-completed-task-completed-when.md) | pending |
| [Make the rollback prompt say what it reverts and default to restoring](./make-the-rollback-prompt-say-what-it.md) | pending |
| [Make the run summary distinguish work failure from record failure and name the commits](./make-the-run-summary-distinguish-work.md) | pending |
| [Stage only the files the serializer wrote in hench completion and reset-deferred commits](./stage-only-the-files-the-serializer.md) | pending |
