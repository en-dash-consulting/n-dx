---
id: "3415b5f0-3496-4813-8cc9-9f571044d49c"
level: "feature"
title: "Run Failure Recovery and Rollback"
status: "pending"
source: "smart-add"
startedAt: "2026-04-16T15:21:00.385Z"
acceptanceCriteria: []
description: "When an ndx work run fails, automatically revert uncommitted file changes and reset the PRD task status back to pending so the user can retry without manual cleanup."
lastModified: "2026-09-12T09:42:34.897Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [A failed run leaves a non-empty .hench-commit-msg.txt, and the next run can commit under it](./a-failed-run-leaves-a-non-empty-hench.md) | pending |
| [Add regression tests for Codex multi-line 'tokens used' output format](./add-regression-tests-for-codex-multi.md) | completed |
| [Add rollback configuration, confirmation UX, and regression tests](./add-rollback-configuration.md) | completed |
| [Implement git change rollback on failed hench runs](./implement-git-change-rollback-on.md) | completed |
