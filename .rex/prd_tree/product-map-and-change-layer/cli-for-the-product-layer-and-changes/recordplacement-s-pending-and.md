---
id: "7421c3a7-c561-48b9-8733-81480e9876b3"
level: "task"
title: "recordPlacement's pending and blockedBy pass-through has no test with a real pending problem, so emptying them goes unnoticed"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A core test calls recordPlacement on a real tree and asserts non-empty pending and blockedBy, or a comment in change-place.ts explains with a proof why place can never produce one"
  - "If option 1: an unstubbed CLI test shows rex change place printing the rex change apply warning"
description: "Found in the adversarial review of 673b243a1 (task 3c6b277f). Verdict: should-fix, medium.\n\nScenario: change packages/rex/src/core/change-place.ts:~178 to return `pending: [], blockedBy: []` whatever the dry run found. Every test still passes. The core test only checks the empty case. tests/unit/cli/commands/change-place-pending.test.ts stubs recordPlacement, so the CLI warning is tested but the core pass-through it relies on is not.\n\nRoot cause: no real placement scenario that produces a *novel* pending problem has been found. `place` only adds `modified` amendments. applyAmendmentsProblems puts only removals in `pending`. recordPlacement keeps only problems that are new after the placement. Probes run in the original session: (a) placing a modify on a capability another open change removes gives no problems; (b) a change that already removes the area, with another change removing the descendant, is already pending before the placement, so the novel diff drops it, and modifying that descendant is refused outright. The pending branch of recordPlacement may be unreachable from `rex change place` and place_change.\n\nOptions:\n1. Find a real tree where a placement adds a novel pending problem, and add a core test asserting non-empty pending and blockedBy. Add an unstubbed CLI test as well. Recommended if such a tree exists.\n2. If a proof shows none exists, document that the warning is defensive and keep the stubbed test. The core test should then pin the empty result explicitly with a comment explaining why. Cheap, but it leaves code that cannot run.\nDecision for Ryan: whether to keep defensive plumbing that cannot be reached."
lastModified: "2026-10-09T17:22:37.102Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
