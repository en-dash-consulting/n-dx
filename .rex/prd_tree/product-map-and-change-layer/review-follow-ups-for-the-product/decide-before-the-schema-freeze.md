---
id: "9fe81459-e04f-4246-a15f-89c381487139"
level: "task"
title: "Decide before the schema freeze whether ChangeIntentSchema gets acceptanceCriteria"
status: "pending"
priority: "high"
acceptanceCriteria: []
description: "Found preparing PR 16 (2026-10-08). The split rule moves a task-less change's criteria to its new first task, but ChangeIntentSchema has requirements and no acceptanceCriteria field. Changes read from v1 trees carry acceptanceCriteria as a passthrough key, so PR 16 moves that key when present (Ryan's decision) without editing schema/v2.ts. Decide before 1.0.0 freezes the schema whether changes get a typed acceptanceCriteria field (an additive optional field is allowed after the freeze, a changed meaning is not), and update the split rule's doc if so."
lastModified: "2026-10-08T16:24:00.394Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
