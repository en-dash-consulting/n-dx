---
id: "85839d4a-3b74-4e79-bb93-838726de17cf"
type: "task"
title: "Document the host-wide validation slot and add its changeset"
slug: "document-the-host-wide-validation-slot"
description: "PR 2 of 3 (host-wide validation slot), task 3 of 3: closes PR 2.\n\nDocument what PR 2 shipped:\n- docs/guide/configuration.md: `hench.testGate.hostSlot`, default off, what it serializes (gate attempts and re-runs, post-task tests, completion test runs) and what it does not (an agent's own shell commands, which only the worker cap bounds).\n- TESTING.md: running several worktrees at once; how to tell a run is waiting and who holds the slot; where the lock lives under the ndx home and that a stale record is reclaimed automatically.\n- Hench docs for run records / `hench show`: `queueMs` and `executionMs`.\n- The concurrency section of docs/architecture/overview.md if it lists what serializes across worktrees.\n\nAdd a patch changeset for `@n-dx/hench` (scoped name; read .claude/skills/ndx-release-notes/SKILL.md first).\n\nIf a docs page is checked by a root docs test (scripts/lib/select-suites.mjs VALIDATED_DOC_PAGES), run that test."
acceptanceCriteria:
  - "Configuration and testing docs describe hench.testGate.hostSlot, its default, its scope and its limits accurately"
  - "Run-record docs describe queueMs and executionMs"
  - "A patch changeset for @n-dx/hench describes the slot"
  - "Root docs tests that read the edited pages pass"
priority: "medium"
tags:
  - "validation-gate"
  - "wave-1"
  - "pr-2-host-slot"
  - "docs"
source: "ndx-capture"
blockedBy:
  - "adb92a12-af68-4f9a-b28b-310fb0ea9980"
---
