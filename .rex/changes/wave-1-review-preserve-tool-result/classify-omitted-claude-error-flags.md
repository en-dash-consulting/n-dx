---
id: "cc303c74-dff1-4c4f-9935-092816f6c40f"
type: "task"
title: "Classify omitted Claude error flags and Codex output by vendor"
slug: "classify-omitted-claude-error-flags"
description: "PR #1006 review comments 4554547469, 4554547481: https://github.com/en-dash-consulting/n-dx/pull/1006#discussion_r4554547469 https://github.com/en-dash-consulting/n-dx/pull/1006#discussion_r4554547481. Cross-reference b37b71d8-e1f6-43d3-9efb-4a82d82d2acf. Approved by the user on 2026-11-12 for the existing seven-PR Wave 1 stack, rebased on main 6f72df28b0319174cb600eb67d94327d0377ed7f. Execute this repair through actual checkout-local ndx work, not direct coordinator edits. Use the configured absolute bundled Codex CLI, mandatory Codex self-review and test gate, scoped patch changesets where applicable, and an atomic code/PRD completion commit with a bare N-DX-Item trailer. Preserve user pins, other work, experimental defaults and unrelated behavior. Do not merge PRs, repair parked Wave 2, duplicate completed findings 8/2/3, or implement unrelated parity work. Identify scripted/mocked fixtures separately from live CLI/browser evidence."
acceptanceCriteria:
  - "Canonical Claude tool success with omitted is_error emits an explicit non-error result, including literal output beginning [error]. Explicit true and false retain precedence."
  - "Originating vendor reaches parsing, persistence, result pairing and the rendered failure decision. Apply legacy prefix fallback only to known Claude results; unflagged Codex function/command output is not failed solely because of text."
  - "Retain archived Claude compatibility and unknown Codex status. Cover parser, persisted/paired event and rendered transcript behavior with meaningful fixtures."
  - "Identify recorded fixtures and their known versions separately from synthetic cases and current live CLI observations. Do not claim untested versions or browser flows are verified."
priority: "medium"
run: {"tier":"heavy","models":{"codex":"gpt-6-astra"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6-astra"},"reviewOptional":false,"skipTestGate":false,"contextNotes":"Approved by the user on 2026-11-12 for the existing seven-PR Wave 1 stack, rebased on main 6f72df28b0319174cb600eb67d94327d0377ed7f. Execute this repair through actual checkout-local ndx work, not direct coordinator edits. Use the configured absolute bundled Codex CLI, mandatory Codex self-review and test gate, scoped patch changesets where applicable, and an atomic code/PRD completion commit with a bare N-DX-Item trailer. Preserve user pins, other work, experimental defaults and unrelated behavior. Do not merge PRs, repair parked Wave 2, duplicate completed findings 8/2/3, or implement unrelated parity work. Identify scripted/mocked fixtures separately from live CLI/browser evidence."}
source: "ndx-capture"
---
