---
id: "76bc42c5-5e68-4513-b341-e917c07c51e7"
level: "task"
title: "Fix ndx add 'Added to:' line to print copy-pasteable folder-tree path of the created item"
status: "completed"
priority: "medium"
tags:
  - "cli"
  - "rex"
  - "ux"
source: "smart-add"
startedAt: "2026-04-30T20:51:12.922Z"
completedAt: "2026-04-30T21:00:16.441Z"
endedAt: "2026-04-30T21:00:16.441Z"
resolutionType: "code-change"
resolutionDetail: "Implemented folder-tree path output for ndx add command. Created getFolderTreePath utility that computes workspace-relative paths like .rex/tree/epic-slug/feature-slug/task-slug. Updated cmdAdd and cmdSmartAdd to use the utility instead of outputting markdown PRD file paths. All regression tests pass."
acceptanceCriteria:
  - "'Added to:' prints a path that exists on disk after the command completes for every created level (epic, feature, task, subtask)"
  - "Path is workspace-relative and shell-pasteable (no truncation, no ellipses, no decorative quoting that would break copy-paste)"
  - "When new ancestor containers are created in the same invocation, the printed path points to the deepest newly created item, not the parent"
  - "Subtask additions print the parent task's index.md path (since subtasks are sections within it), not a non-existent subtask directory"
  - "Output is consistent between ndx add and direct rex add invocations"
description: "After the PRD storage migration to the slug-based folder tree under .rex/tree/, the 'Added to:' line emitted by ndx add (and the underlying rex add) no longer points to a real, copy-pasteable filesystem location for the newly created item. Update the post-write summary so the path resolves to the actual directory or index.md the new epic/feature/task/subtask was written to (e.g. .rex/tree/<epic-slug>/<feature-slug>/<task-slug>/index.md), using a path the user can paste directly into a terminal or editor to open the file or cd into the folder. Cover all item levels and the case where new ancestor containers are created in the same call."
---

# Fix ndx add 'Added to:' line to print copy-pasteable folder-tree path of the created item

🟡 [completed]

## Summary

After the PRD storage migration to the slug-based folder tree under .rex/tree/, the 'Added to:' line emitted by ndx add (and the underlying rex add) no longer points to a real, copy-pasteable filesystem location for the newly created item. Update the post-write summary so the path resolves to the actual directory or index.md the new epic/feature/task/subtask was written to (e.g. .rex/tree/<epic-slug>/<feature-slug>/<task-slug>/index.md), using a path the user can paste directly into a terminal or editor to open the file or cd into the folder. Cover all item levels and the case where new ancestor containers are created in the same call.

## Info

- **Status:** completed
- **Priority:** medium
- **Tags:** cli, rex, ux
- **Level:** task
- **Started:** 2026-04-30T20:51:12.922Z
- **Completed:** 2026-04-30T21:00:16.441Z
- **Duration:** 9m
