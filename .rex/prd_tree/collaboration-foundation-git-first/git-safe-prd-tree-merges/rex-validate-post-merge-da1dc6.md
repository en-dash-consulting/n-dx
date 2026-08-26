---
id: "da1dc657-d5cb-48fe-8fee-e2ff97216742"
level: "task"
title: "rex validate --post-merge structural check"
status: "completed"
priority: "medium"
startedAt: "2026-08-26T12:39:11.733Z"
completedAt: "2026-08-26T12:56:36.262Z"
endedAt: "2026-08-26T12:56:36.262Z"
acceptanceCriteria: []
description: "After a git merge of the PRD tree there is no validation: duplicate IDs, orphaned directories, level/nesting mismatches, and dangling blockedBy references can all survive silently. Extend rex validate with a --post-merge mode detecting each corruption class, reporting them, and offering --repair for the safe ones. Document wiring it as an optional git post-merge hook. PR boundary: validate command extension only. Acceptance criteria: (1) fixture tests for each corruption class; (2) --repair fixes safe classes and refuses ambiguous ones; (3) exit codes suitable for hook use; (4) docs updated."
lastModified: "2026-08-26T12:56:36.268Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
