---
id: "0e2b33cb-8962-4461-8bf6-b9da271a3197"
level: "task"
title: "Add regression tests asserting the 'Added to:' path resolves on disk for all PRD item levels"
status: "completed"
priority: "medium"
tags:
  - "test"
  - "rex"
  - "cli"
source: "smart-add"
startedAt: "2026-04-30T20:44:05.457Z"
completedAt: "2026-04-30T20:50:55.924Z"
endedAt: "2026-04-30T20:50:55.924Z"
resolutionType: "code-change"
resolutionDetail: "Created comprehensive e2e test suite (cli-add-path-regression.test.ts) with 7 test cases covering all item levels and scenarios. Tests verify 'Added to:' path is workspace-relative, exists on disk, and maintains consistent format. Tests fail as expected pending implementation of the folder-tree path output fix."
acceptanceCriteria:
  - "Test cases cover epic, feature, task, and subtask creation"
  - "Test case covers a single invocation that creates new ancestor containers and asserts the deepest path is printed"
  - "Each test parses the 'Added to:' line from CLI stdout and verifies the path exists via fs.stat"
  - "Tests assert paths are workspace-relative (no absolute paths, no leading ./ inconsistencies)"
  - "Tests run as part of the standard rex/ndx integration suite"
description: "Lock in the corrected behavior with integration tests that run ndx add (and rex add) for each item level — epic, feature, task, subtask — plus a case that creates new ancestor containers in one call. Each test parses the 'Added to:' line from stdout and asserts the path exists on disk after the command, points at the newly created item, and is workspace-relative. This guards against future folder-tree schema changes silently breaking the copy-paste affordance again."
---

# Add regression tests asserting the 'Added to:' path resolves on disk for all PRD item levels

🟡 [completed]

## Summary

Lock in the corrected behavior with integration tests that run ndx add (and rex add) for each item level — epic, feature, task, subtask — plus a case that creates new ancestor containers in one call. Each test parses the 'Added to:' line from stdout and asserts the path exists on disk after the command, points at the newly created item, and is workspace-relative. This guards against future folder-tree schema changes silently breaking the copy-paste affordance again.

## Info

- **Status:** completed
- **Priority:** medium
- **Tags:** test, rex, cli
- **Level:** task
- **Started:** 2026-04-30T20:44:05.457Z
- **Completed:** 2026-04-30T20:50:55.924Z
- **Duration:** 6m
