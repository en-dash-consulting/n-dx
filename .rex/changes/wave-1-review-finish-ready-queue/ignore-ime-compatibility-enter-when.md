---
id: "7f67d527-b7a1-4025-964b-8d1029a61b8b"
type: "task"
title: "Ignore IME compatibility Enter when adding acceptance criteria"
slug: "ignore-ime-compatibility-enter-when"
description: "PR #1000 review comments 4554546581: https://github.com/en-dash-consulting/n-dx/pull/1000#discussion_r4554546581. Cross-reference b2d58519-a069-4b03-9aef-3cc5753b1055, b9f53670-8e31-4f3f-a630-786ca4800d3a. Approved by the user on 2026-11-12 for the existing seven-PR Wave 1 stack, rebased on main 6f72df28b0319174cb600eb67d94327d0377ed7f. Execute this repair through actual checkout-local ndx work, not direct coordinator edits. Use the configured absolute bundled Codex CLI, mandatory Codex self-review and test gate, scoped patch changesets where applicable, and an atomic code/PRD completion commit with a bare N-DX-Item trailer. Preserve user pins, other work, experimental defaults and unrelated behavior. Do not merge PRs, repair parked Wave 2, duplicate completed findings 8/2/3, or implement unrelated parity work. Identify scripted/mocked fixtures separately from live CLI/browser evidence."
acceptanceCriteria:
  - "A synthetic Enter with isComposing=false and keyCode=229 preserves the draft and adds or submits nothing. Composing Enter remains ignored."
  - "An ordinary Enter adds exactly one acceptance criterion without submitting the form. Tests assert the meaningful draft, add and submit behavior."
  - "Separate synthetic event coverage from real Safari/WebKit behavior; do not claim a browser was tested unless actually exercised."
priority: "medium"
run: {"tier":"standard","models":{"codex":"gpt-6.1-sol"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6-astra"},"reviewOptional":false,"skipTestGate":false,"contextNotes":"Approved by the user on 2026-11-12 for the existing seven-PR Wave 1 stack, rebased on main 6f72df28b0319174cb600eb67d94327d0377ed7f. Execute this repair through actual checkout-local ndx work, not direct coordinator edits. Use the configured absolute bundled Codex CLI, mandatory Codex self-review and test gate, scoped patch changesets where applicable, and an atomic code/PRD completion commit with a bare N-DX-Item trailer. Preserve user pins, other work, experimental defaults and unrelated behavior. Do not merge PRs, repair parked Wave 2, duplicate completed findings 8/2/3, or implement unrelated parity work. Identify scripted/mocked fixtures separately from live CLI/browser evidence."}
source: "ndx-capture"
---
