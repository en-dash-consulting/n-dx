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
  - "A core test places a modified amendment on a capability that another open change removes and asserts the placement returns no problems, no pending and no blockedBy (test)"
  - "A core test places a modified amendment on a descendant of a node under a pending removal and asserts it is refused, not stored with pending warnings (test)"
  - "recordPlacement carries a comment that its pending branch is defensive (place writes only modified amendments; pending comes only from removals; pre-existing pending is filtered) and names the two tests"
  - "The stubbed CLI test (change-place-pending.test.ts) stays and its comment points at the core tests"
description: "Found in the adversarial review of 673b243a1 (task 3c6b277f). Verdict: should-fix, medium.\n\nScenario: change packages/rex/src/core/change-place.ts:~178 to return `pending: [], blockedBy: []` whatever the dry run found. Every test still passes. The core test only checks the empty case. tests/unit/cli/commands/change-place-pending.test.ts stubs recordPlacement, so the CLI warning is tested but the core pass-through it relies on is not.\n\nRoot cause: no real placement scenario that produces a *novel* pending problem has been found. `place` only adds `modified` amendments. applyAmendmentsProblems puts only removals in `pending`. recordPlacement keeps only problems that are new after the placement. Probes run in the original session: (a) placing a modify on a capability another open change removes gives no problems; (b) a change that already removes the area, with another change removing the descendant, is already pending before the placement, so the novel diff drops it, and modifying that descendant is refused outright. The pending branch of recordPlacement may be unreachable from `rex change place` and place_change.\n\nOptions:\n1. Find a real tree where a placement adds a novel pending problem, and add a core test asserting non-empty pending and blockedBy. Add an unstubbed CLI test as well. Recommended if such a tree exists.\n2. If a proof shows none exists, document that the warning is defensive and keep the stubbed test. The core test should then pin the empty result explicitly with a comment explaining why. Cheap, but it leaves code that cannot run.\nDecision for Ryan: whether to keep defensive plumbing that cannot be reached.\n\nDecided (Ryan, 2026-10-09): option 2. Keep the pending/blockedBy pass-through and the CLI rendering: MCP place_change returns the same warnings field from the same core result (soft-frozen at 0.9.0), and the code becomes live if place ever writes a removal. Pin why it is empty today with core tests built from the probes above, and add a comment on recordPlacement saying the pending branch is defensive and naming those tests. Do not remove the stubbed CLI test; its comment should point at the core tests."
lastModified: "2026-10-09T17:39:48.399Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
