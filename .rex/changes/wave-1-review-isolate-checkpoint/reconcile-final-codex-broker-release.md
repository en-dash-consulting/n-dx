---
id: "2c2a29e3-c04c-46ef-ac92-93f1bf3992ca"
type: "task"
title: "Reconcile final Codex broker release notes with delivered behavior"
slug: "reconcile-final-codex-broker-release"
description: "PR #1008 review comments 4554547786: https://github.com/en-dash-consulting/n-dx/pull/1008#discussion_r4554547786. Cross-reference 4191c8d5-58d7-4153-a3fa-17f2b813d792, 49104d5b-f333-4685-82b0-51a1ad8e402f, 8d2ff447-281c-4255-8634-f2cce8bcd6cf. Approved by the user on 2026-11-12 for the existing seven-PR Wave 1 stack, rebased on main 6f72df28b0319174cb600eb67d94327d0377ed7f. Execute this repair through actual checkout-local ndx work, not direct coordinator edits. Use the configured absolute bundled Codex CLI, mandatory Codex self-review and test gate, scoped patch changesets where applicable, and an atomic code/PRD completion commit with a bare N-DX-Item trailer. Preserve user pins, other work, experimental defaults and unrelated behavior. Do not merge PRs, repair parked Wave 2, duplicate completed findings 8/2/3, or implement unrelated parity work. Identify scripted/mocked fixtures separately from live CLI/browser evidence."
acceptanceCriteria:
  - "Remove intermediate sessions-stay-refused wording and describe complete disabled transport placeholders consistently in the review-named release notes."
  - "Preserve accurate remaining hub/provider restrictions and untested-version limits, scoped package names and patch versions; do not imply future parity work is delivered."
  - "Finalize text after the checkpoint/accounting behavior is settled, satisfy the release-note policy and do not change runtime behavior or invent no-op source changes."
priority: "medium"
run: {"tier":"standard","models":{"codex":"gpt-6.1-sol"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6-astra"},"reviewOptional":false,"skipTestGate":false,"contextNotes":"Approved by the user on 2026-11-12 for the existing seven-PR Wave 1 stack, rebased on main 6f72df28b0319174cb600eb67d94327d0377ed7f. Execute this repair through actual checkout-local ndx work, not direct coordinator edits. Use the configured absolute bundled Codex CLI, mandatory Codex self-review and test gate, scoped patch changesets where applicable, and an atomic code/PRD completion commit with a bare N-DX-Item trailer. Preserve user pins, other work, experimental defaults and unrelated behavior. Do not merge PRs, repair parked Wave 2, duplicate completed findings 8/2/3, or implement unrelated parity work. Identify scripted/mocked fixtures separately from live CLI/browser evidence."}
source: "ndx-capture"
blockedBy:
  - "bd3cc75d-f678-4f6c-948f-55d7bc26b77c"
---
