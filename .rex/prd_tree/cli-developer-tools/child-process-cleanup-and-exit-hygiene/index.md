---
id: "b67648eb-e1a0-4420-89e0-2052b810ead4"
level: "feature"
title: "Child Process Cleanup and Exit Hygiene"
status: "pending"
source: "smart-add"
startedAt: "2026-04-03T14:08:58.077Z"
acceptanceCriteria: []
description: "Ensure `n-dx` tears down all spawned child processes and lingering worker threads when commands complete, fail, or are interrupted so local machines are not left with orphaned SourceVision-related activity."
lastModified: "2026-09-12T10:11:46.919Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Add regression coverage for parent-exit cleanup and orphan prevention](./add-regression-coverage-for-parent.md) | completed |
| [Harden SourceVision test execution against lingering workers and orphaned threads](./harden-sourcevision-test-execution.md) | completed |
| [Implement unified child-process teardown for n-dx command lifecycles](./implement-unified-child-process.md) | completed |
| [terminateTree and terminateTreeByPid are never exercised against a real OS process](./terminatetree-and-terminatetreebypid.md) | pending |
