---
id: "9fe81459-e04f-4246-a15f-89c381487139"
level: "task"
title: "Give v2 changes an optional acceptanceCriteria list"
status: "pending"
priority: "high"
tags:
  - "pr-17"
  - "lane-rex-surface"
  - "rex"
acceptanceCriteria:
  - "ChangeIntentSchema declares acceptanceCriteria as an optional string list (test)"
  - "The split moves a change's acceptanceCriteria to its new first task as a typed list (test)"
  - "A change's acceptanceCriteria never change its targets' spec hash or product status (test)"
description: "Decided 2026-10-08 (Ryan): changes get an optional, typed `acceptanceCriteria: string[]`, with the same name and shape as a task's, meaning \"done when\" for the change's own work. It is not a capability's `criteria` (objects with ids `{id, text}`: the standing spec of the product, part of the spec hash). A change's acceptanceCriteria never feed specHash, metAt, reviewedHash, amendments or product status; amendments keep carrying capability criteria through `criteria` deltas or `proposed`.\n\nWork: add `acceptanceCriteria?: string[]` to ChangeIntentSchema in packages/rex/src/schema/v2.ts and its zod schema (an approved schema edit). The PR 16 split rule now moves a typed list to the first task; update its doc comment. A v1 change's passthrough acceptanceCriteria key becomes the typed field. MCP add_item and edit_item accept acceptanceCriteria for changes. The v2 rules do not require it.\n\nTerminology: say \"capability criteria\" for a capability's `criteria` and \"acceptance criteria\" or \"done when\" for a work item's `acceptanceCriteria`; never a bare \"criteria\" in user-facing text.\n\nFound preparing PR 16 (2026-10-08). The split rule moves a task-less change's criteria to its new first task, but ChangeIntentSchema has requirements and no acceptanceCriteria field. Changes read from v1 trees carry acceptanceCriteria as a passthrough key, so PR 16 moves that key when present (Ryan's decision) without editing schema/v2.ts. Decide before 1.0.0 freezes the schema whether changes get a typed acceptanceCriteria field (an additive optional field is allowed after the freeze, a changed meaning is not), and update the split rule's doc if so."
lastModified: "2026-10-08T20:19:36.182Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
