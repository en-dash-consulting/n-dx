---
id: "602a4abc-b997-4f9b-ab61-4bc092b40518"
type: "capability"
title: "Task selection must use the shared completed-child predicate"
slug: "task-selection-must-use-the-shared"
statement: "Rex's next-task selection uses the same completed-child rule as parent completion to decide whether a parent is actionable."
criteria: [{"id":"c1","text":"When choosing the next task, task selection shall decide whether a parent's children are complete using the shared parent-completion predicate, not a separate status check of its own."},{"id":"c2","text":"When a parent has a deferred child, task selection shall not select that parent or present it as ready to finalize."},{"id":"c3","text":"When a parent has a cancelled child, task selection shall treat that child by the same completed-child rule that parent completion, validation and rex fix use, so all of these tools agree on whether the parent is actionable."}]
tags:
  - "rex"
  - "task-selection"
  - "parent-completion"
  - "ndx-capture"
source: "ndx-capture"
priority: "medium"
---

P2 follow-up approved for PR #370. Rex parent completion treats only completed children as successful, but next-task selection still treats deferred and cancelled children as done. This lets Hench select and complete a parent that Rex later reopens, causing the tools to disagree. Make task selection use the shared parent-completion predicate and add deterministic coverage for deferred and cancelled children. Review evidence: packages/rex/src/core/next-task.ts collectActionable behavior diverges from the shared parent-completion rule.
