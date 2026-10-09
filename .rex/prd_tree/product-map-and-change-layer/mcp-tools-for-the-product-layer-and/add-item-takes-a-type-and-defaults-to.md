---
id: "fdddee24-1661-4f65-adc7-3946452bc8f8"
level: "task"
title: "add_item takes a type and defaults to a change in the Inbox"
status: "pending"
priority: "high"
tags:
  - "pr-17"
  - "lane-rex-surface"
  - "rex"
blockedBy:
  - "9fe81459-e04f-4246-a15f-89c381487139"
source: "roadmap"
acceptanceCriteria:
  - "level-only calls are refused with a message naming type (test)"
  - "A call with no type creates an Inbox change (test)"
  - "add_item refuses a task under a completed, applied or cancelled change, and the message suggests a follow-up change with discoveredFrom (test)"
description: "add_item accepts type plus amends and touches. A call with only level is refused with a message naming type. A call with neither creates a change in the Inbox with needsPlacement.\n\nAdding a task (add_item with type task, or core addTask) under a change that is completed, applied (appliedAt set), cancelled or deleted is refused; the error names the change's state and suggests a follow-up change with discoveredFrom set to the closed change (decided 2026-10-08).\n\n## Decisions (2026-10-07, operator)\n\n**The Inbox is a reserved folder**, not a view: an unplaced change is created at `changes/inbox/<slug>/index.md` with `needsPlacement: true` in that folder's `state.yaml`. Placement later moves it under an area. (The alternative considered and rejected was \"Inbox = anything with needsPlacement, written at the changes root\".)\n\n```\n.ndx/rex/changes/\n  inbox/\n    add-token-redaction/\n      index.md      type: change\n    state.yaml      needsPlacement: true\n  auth/\n    <placed changes>\n```\n\n**Blocked in practice on the v2 store.** The v2 reader and writer exist (PR 9) but `prd-model-writer.ts` states it is \"wired to nothing yet: the v2 store calls it when it lands\", and this repository's own tree is still `rex/v1` with no `product/` or `changes/` directories. `add_item` today writes v1 through `PRDStore`, and is called by hench's adversarial-review capture, `workflow/default.ts` and self-heal tagging — so refusing `level` now would break the agent's own capture path while nothing can yet create a v2 change. Do this task after the v2 store lands, and refuse `level` then rather than shipping a dual-vocabulary tool that has to be unshipped."
lastModified: "2026-10-08T18:56:26.543Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
