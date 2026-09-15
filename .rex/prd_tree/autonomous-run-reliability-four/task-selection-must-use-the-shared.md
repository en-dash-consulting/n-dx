---
id: "602a4abc-b997-4f9b-ab61-4bc092b40518"
level: "task"
title: "Task selection must use the shared completed-child predicate"
status: "pending"
priority: "medium"
tags:
  - "rex"
  - "task-selection"
  - "parent-completion"
  - "ndx-capture"
source: "ndx-capture"
acceptanceCriteria:
  - "Task selection uses the shared parent-completion predicate instead of a private completed-or-deferred-or-cancelled status check."
  - "A parent with a deferred child is not selected or presented as ready to finalize."
  - "A parent with a cancelled child follows the same completed-child semantics as parent completion, validation, and rex fix; the tools cannot disagree about whether it is actionable."
  - "Deterministic next-task tests cover completed-plus-deferred and completed-plus-cancelled child sets."
  - "Focused Rex tests and typecheck pass, with a patch changeset for @n-dx/rex."
description: "P2 follow-up approved for PR #370. Rex parent completion treats only completed children as successful, but next-task selection still treats deferred and cancelled children as done. This lets Hench select and complete a parent that Rex later reopens, causing the tools to disagree. Make task selection use the shared parent-completion predicate and add deterministic coverage for deferred and cancelled children. Review evidence: packages/rex/src/core/next-task.ts collectActionable behavior diverges from the shared parent-completion rule."
lastModified: "2026-09-15T02:08:41.344Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
