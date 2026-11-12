---
id: "3a19ff39-2de2-4871-9d3e-fd804d6ac1e0"
type: "task"
title: "Isolate cached and in-flight auth checks by workspace context"
slug: "isolate-cached-and-in-flight-auth"
description: "PR #1003 review comments 4508160561: https://github.com/en-dash-consulting/n-dx/pull/1003#discussion_r4508160561. Cross-reference c963030c-f6cd-4e05-a927-d18cf0af5adb, e46feb51-c637-4b86-b39e-cb8ab72f0dc7. Approved by the user on 2026-11-12 for the existing seven-PR Wave 1 stack, rebased on main 6f72df28b0319174cb600eb67d94327d0377ed7f. Execute this repair through actual checkout-local ndx work, not direct coordinator edits. Use the configured absolute bundled Codex CLI, mandatory Codex self-review and test gate, scoped patch changesets where applicable, and an atomic code/PRD completion commit with a bare N-DX-Item trailer. Preserve user pins, other work, experimental defaults and unrelated behavior. Do not merge PRs, repair parked Wave 2, duplicate completed findings 8/2/3, or implement unrelated parity work. Identify scripted/mocked fixtures separately from live CLI/browser evidence."
acceptanceCriteria:
  - "Key both cached verdicts and in-flight checks by the relevant workspace/config context so a result cannot leak to another workspace or configuration."
  - "Same-key concurrent requests still coalesce efficiently; different contexts do not evict a single shared slot or receive one another's results."
  - "Use a deterministic synthetic concurrent two-workspace regression with no production auth mutation. Preserve project/local precedence, existing CLI/API behavior and secret-free keys/logging."
priority: "medium"
run: {"tier":"heavy","models":{"codex":"gpt-6-astra"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6-astra"},"reviewOptional":false,"skipTestGate":false,"contextNotes":"Approved by the user on 2026-11-12 for the existing seven-PR Wave 1 stack, rebased on main 6f72df28b0319174cb600eb67d94327d0377ed7f. Execute this repair through actual checkout-local ndx work, not direct coordinator edits. Use the configured absolute bundled Codex CLI, mandatory Codex self-review and test gate, scoped patch changesets where applicable, and an atomic code/PRD completion commit with a bare N-DX-Item trailer. Preserve user pins, other work, experimental defaults and unrelated behavior. Do not merge PRs, repair parked Wave 2, duplicate completed findings 8/2/3, or implement unrelated parity work. Identify scripted/mocked fixtures separately from live CLI/browser evidence."}
source: "ndx-capture"
---
