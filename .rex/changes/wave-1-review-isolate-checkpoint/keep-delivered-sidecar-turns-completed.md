---
id: "bd3cc75d-f678-4f6c-948f-55d7bc26b77c"
type: "task"
title: "Keep delivered Sidecar turns completed when checkpoint creation fails"
slug: "keep-delivered-sidecar-turns-completed"
description: "PR #1008 review comments 4554547768: https://github.com/en-dash-consulting/n-dx/pull/1008#discussion_r4554547768. Cross-reference 4191c8d5-58d7-4153-a3fa-17f2b813d792, 49104d5b-f333-4685-82b0-51a1ad8e402f, 8d2ff447-281c-4255-8634-f2cce8bcd6cf. Approved by the user on 2026-11-12 for the existing seven-PR Wave 1 stack, rebased on main 6f72df28b0319174cb600eb67d94327d0377ed7f. Execute this repair through actual checkout-local ndx work, not direct coordinator edits. Use the configured absolute bundled Codex CLI, mandatory Codex self-review and test gate, scoped patch changesets where applicable, and an atomic code/PRD completion commit with a bare N-DX-Item trailer. Preserve user pins, other work, experimental defaults and unrelated behavior. Do not merge PRs, repair parked Wave 2, duplicate completed findings 8/2/3, or implement unrelated parity work. Identify scripted/mocked fixtures separately from live CLI/browser evidence."
acceptanceCriteria:
  - "After a delivered answer, a refused checkpoint spawn or configuration parsing failure preserves the completed-turn outcome, records the original measured spend exactly once, emits a visible diagnostic and allows safe subsequent cold recovery."
  - "Successful checkpoint spend remains included; moving the recorder earlier must not lose that usage. Failure handling must not double-record original or checkpoint usage."
  - "Exercise production route/accounting wiring with disposable configuration and scripted-session fixtures without live vendor calls or production task data. Reuse existing recorder-wiring coverage item 4191c8d5 rather than capturing a duplicate."
priority: "medium"
run: {"tier":"heavy","models":{"codex":"gpt-6-astra"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6-astra"},"reviewOptional":false,"skipTestGate":false,"contextNotes":"Approved by the user on 2026-11-12 for the existing seven-PR Wave 1 stack, rebased on main 6f72df28b0319174cb600eb67d94327d0377ed7f. Execute this repair through actual checkout-local ndx work, not direct coordinator edits. Use the configured absolute bundled Codex CLI, mandatory Codex self-review and test gate, scoped patch changesets where applicable, and an atomic code/PRD completion commit with a bare N-DX-Item trailer. Preserve user pins, other work, experimental defaults and unrelated behavior. Do not merge PRs, repair parked Wave 2, duplicate completed findings 8/2/3, or implement unrelated parity work. Identify scripted/mocked fixtures separately from live CLI/browser evidence."}
source: "ndx-capture"
blockedBy:
  - "4191c8d5-58d7-4153-a3fa-17f2b813d792"
---
