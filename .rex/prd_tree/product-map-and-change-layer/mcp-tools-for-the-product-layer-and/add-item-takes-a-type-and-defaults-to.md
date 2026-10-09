---
id: "fdddee24-1661-4f65-adc7-3946452bc8f8"
level: "task"
title: "add_item takes a type and defaults to a change in the Inbox"
status: "completed"
priority: "high"
tags:
  - "pr-17"
  - "lane-rex-surface"
  - "rex"
blockedBy:
  - "9fe81459-e04f-4246-a15f-89c381487139"
source: "roadmap"
startedAt: "2026-10-09T01:04:01.321Z"
completedAt: "2026-10-09T01:18:58.048Z"
endedAt: "2026-10-09T01:18:58.048Z"
resolutionType: "code-change"
resolutionDetail: "add_item dispatches on layout: v2 takes type (default change → Inbox with needsPlacement), refuses level; v1 unchanged, refuses v2-only types/fields. addTask refuses closed changes (ClosedChangeError suggests discoveredFrom follow-up). get_item reads v2."
acceptanceCriteria:
  - "level-only calls are refused with a message naming type (test)"
  - "A call with no type creates an Inbox change (test)"
  - "add_item refuses a task under a completed, applied or cancelled change, and the message suggests a follow-up change with discoveredFrom (test)"
  - "add_item creates a change with acceptanceCriteria and get_item returns them (test)"
run: {"contextNotes":"Rebuild before finishing: after your last edit under packages/<pkg>/src, run `pnpm --filter @n-dx/<pkg> build`, and run it again if the adversarial review repairs any file under packages/<pkg>/src. Hench runs its affected test gate right after the review without rebuilding, and the gate refuses a stale dist/ (runs d3e891fe and 699cd138 failed this way; tracked as a hench bug under d0c26ff0)."}
description: "add_item accepts type plus amends and touches. A call with only level is refused with a message naming type. A call with neither creates a change in the Inbox with needsPlacement.\n\nAdding a task (add_item with type task, or core addTask) under a change that is completed, applied (appliedAt set), cancelled or deleted is refused; the error names the change's state and suggests a follow-up change with discoveredFrom set to the closed change (decided 2026-10-08).\n\nv1 and v2 (decided 2026-10-08, Ryan): v1 trees keep today's behaviour. The `type` parameter, the Inbox default and the refusal of level-only calls apply to v2 trees only; on a v1 tree add_item accepts `level` exactly as today, because this repository's PRD stays v1 until PRs 23 and 26 and skills and hench agents call add_item with `level` on it. `level` becomes optional in the input schema and `type` is added (additive shape change). On a v1 tree, a `type` that v1 has no level for (`change` and other v2-only types) is refused with a message naming the v1 layout, never mapped silently. The closed-change refusal is v2-only, since v1 has no changes. The hench agent tool allowlist and skill wording are unchanged here (PR 19)."
lastModified: "2026-10-09T01:18:58.306Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
