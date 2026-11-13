---
id: "cad202df-4f3c-420d-9b41-0c9c445c352b"
type: "task"
title: "Qualify the six Sidecar release leads as experimental and default-off"
slug: "qualify-the-six-sidecar-release-leads"
description: "PR #998 review comments 4554546330: https://github.com/en-dash-consulting/n-dx/pull/998#discussion_r4554546330. Cross-reference fc83b4cb-5237-4422-b590-d743d0f11c37, 6383a949-3657-4802-ad9d-c90885b2f546. Approved by the user on 2026-11-12 for the existing seven-PR Wave 1 stack, rebased on main 6f72df28b0319174cb600eb67d94327d0377ed7f. Execute this repair through actual checkout-local ndx work, not direct coordinator edits. Use the configured absolute bundled Codex CLI, mandatory Codex self-review and test gate, scoped patch changesets where applicable, and an atomic code/PRD completion commit with a bare N-DX-Item trailer. Preserve user pins, other work, experimental defaults and unrelated behavior. Do not merge PRs, repair parked Wave 2, duplicate completed findings 8/2/3, or implement unrelated parity work. Identify scripted/mocked fixtures separately from live CLI/browser evidence."
acceptanceCriteria:
  - "Each of the six review-named Sidecar changeset leads clearly qualifies experimental/default-off web.sidecar behavior and satisfies the release-note policy and word limit."
  - "Preserve scoped package names and patch bumps. Do not change feature defaults or runtime behavior, and do not invent a no-op code change for this documentation repair."
priority: "medium"
run: {"tier":"standard","models":{"codex":"gpt-6.1-sol"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6-astra"},"reviewOptional":false,"skipTestGate":false,"contextNotes":"Approved by the user on 2026-11-12 for the existing seven-PR Wave 1 stack, rebased on main 6f72df28b0319174cb600eb67d94327d0377ed7f. Execute this repair through actual checkout-local ndx work, not direct coordinator edits. Use the configured absolute bundled Codex CLI, mandatory Codex self-review and test gate, scoped patch changesets where applicable, and an atomic code/PRD completion commit with a bare N-DX-Item trailer. Preserve user pins, other work, experimental defaults and unrelated behavior. Do not merge PRs, repair parked Wave 2, duplicate completed findings 8/2/3, or implement unrelated parity work. Identify scripted/mocked fixtures separately from live CLI/browser evidence."}
source: "ndx-capture"
---
