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
  - "add_item creates a change with acceptanceCriteria and get_item returns them (test)"
description: "add_item accepts type plus amends and touches. A call with only level is refused with a message naming type. A call with neither creates a change in the Inbox with needsPlacement.\n\nAdding a task (add_item with type task, or core addTask) under a change that is completed, applied (appliedAt set), cancelled or deleted is refused; the error names the change's state and suggests a follow-up change with discoveredFrom set to the closed change (decided 2026-10-08)."
lastModified: "2026-10-08T20:19:39.162Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
