---
id: "d5a40da2-eae2-4a1e-b515-34dd5d1bc72d"
type: "task"
title: "Align the Web to Rex gateway inventory with Ready selection"
slug: "align-the-web-to-rex-gateway-inventory"
description: "PR #1000 review comments 4554546562: https://github.com/en-dash-consulting/n-dx/pull/1000#discussion_r4554546562. Cross-reference b2d58519-a069-4b03-9aef-3cc5753b1055, b9f53670-8e31-4f3f-a630-786ca4800d3a. Approved by the user on 2026-11-12 for the existing seven-PR Wave 1 stack, rebased on main 6f72df28b0319174cb600eb67d94327d0377ed7f. Execute this repair through actual checkout-local ndx work, not direct coordinator edits. Use the configured absolute bundled Codex CLI, mandatory Codex self-review and test gate, scoped patch changesets where applicable, and an atomic code/PRD completion commit with a bare N-DX-Item trailer. Preserve user pins, other work, experimental defaults and unrelated behavior. Do not merge PRs, repair parked Wave 2, duplicate completed findings 8/2/3, or implement unrelated parity work. Identify scripted/mocked fixtures separately from live CLI/browser evidence."
acceptanceCriteria:
  - "The Web-to-Rex gateway inventory names findActionableWork and explains its Ready selection role; its count matches the owning layer's enforced ceiling of 137."
  - "Repair documentation only: do not raise the ceiling or change exports to make the inventory agree. Preserve the established gateway architecture and use supported documentation-task validation."
priority: "medium"
run: {"tier":"standard","models":{"codex":"gpt-6.1-sol"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6-astra"},"reviewOptional":false,"skipTestGate":false,"contextNotes":"Approved by the user on 2026-11-12 for the existing seven-PR Wave 1 stack, rebased on main 6f72df28b0319174cb600eb67d94327d0377ed7f. Execute this repair through actual checkout-local ndx work, not direct coordinator edits. Use the configured absolute bundled Codex CLI, mandatory Codex self-review and test gate, scoped patch changesets where applicable, and an atomic code/PRD completion commit with a bare N-DX-Item trailer. Preserve user pins, other work, experimental defaults and unrelated behavior. Do not merge PRs, repair parked Wave 2, duplicate completed findings 8/2/3, or implement unrelated parity work. Identify scripted/mocked fixtures separately from live CLI/browser evidence."}
source: "ndx-capture"
---
