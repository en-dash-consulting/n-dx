---
id: "91257435-cb8e-4255-b4eb-f363aca7de9b"
type: "task"
title: "Invalidate auth verdicts for credential and trust changes"
slug: "invalidate-auth-verdicts-for"
description: "PR #1003 review comments 4508160562: https://github.com/en-dash-consulting/n-dx/pull/1003#discussion_r4508160562. Cross-reference c963030c-f6cd-4e05-a927-d18cf0af5adb, e46feb51-c637-4b86-b39e-cb8ab72f0dc7. Approved by the user on 2026-11-12 for the existing seven-PR Wave 1 stack, rebased on main 6f72df28b0319174cb600eb67d94327d0377ed7f. Execute this repair through actual checkout-local ndx work, not direct coordinator edits. Use the configured absolute bundled Codex CLI, mandatory Codex self-review and test gate, scoped patch changesets where applicable, and an atomic code/PRD completion commit with a bare N-DX-Item trailer. Preserve user pins, other work, experimental defaults and unrelated behavior. Do not merge PRs, repair parked Wave 2, duplicate completed findings 8/2/3, or implement unrelated parity work. Identify scripted/mocked fixtures separately from live CLI/browser evidence."
acceptanceCriteria:
  - "Known credential, auth and trust changes invalidate the appropriate cached verdict. Opaque external CLI/keychain state has explicit bounded freshness and a working forced recheck rather than indefinite stale reuse."
  - "Tests cover known invalidation, expiry, forced recheck and concurrent/workspace behavior using synthetic fixtures. No real credential mutation probes, automatic login or secret material in cache keys or logs."
  - "Keep source comments and PR wording aligned with what is actually detected. Preserve project/local configuration precedence and CLI/API authentication behavior."
priority: "medium"
run: {"tier":"heavy","models":{"codex":"gpt-6-astra"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6-astra"},"reviewOptional":false,"skipTestGate":false,"contextNotes":"Approved by the user on 2026-11-12 for the existing seven-PR Wave 1 stack, rebased on main 6f72df28b0319174cb600eb67d94327d0377ed7f. Execute this repair through actual checkout-local ndx work, not direct coordinator edits. Use the configured absolute bundled Codex CLI, mandatory Codex self-review and test gate, scoped patch changesets where applicable, and an atomic code/PRD completion commit with a bare N-DX-Item trailer. Preserve user pins, other work, experimental defaults and unrelated behavior. Do not merge PRs, repair parked Wave 2, duplicate completed findings 8/2/3, or implement unrelated parity work. Identify scripted/mocked fixtures separately from live CLI/browser evidence."}
source: "ndx-capture"
blockedBy:
  - "3a19ff39-2de2-4871-9d3e-fd804d6ac1e0"
---
