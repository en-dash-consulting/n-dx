---
id: "637b25c8-9fed-47d1-b1ef-5a0289a6e0cb"
type: "task"
title: "Keep both rename endpoints in leftover-work recovery actions"
slug: "keep-both-rename-endpoints-in-leftover"
description: "PR #1004 review comments 4554547191: https://github.com/en-dash-consulting/n-dx/pull/1004#discussion_r4554547191. Cross-reference 181fe90f-cf21-4fce-9569-fb7fe52ed4c6, bc98e476-b15f-4b1d-9b24-352ca15bcf6b, 93871c16-aeb7-4027-9b76-0054a992ba41. Approved by the user on 2026-11-12 for the existing seven-PR Wave 1 stack, rebased on main 6f72df28b0319174cb600eb67d94327d0377ed7f. Execute this repair through actual checkout-local ndx work, not direct coordinator edits. Use the configured absolute bundled Codex CLI, mandatory Codex self-review and test gate, scoped patch changesets where applicable, and an atomic code/PRD completion commit with a bare N-DX-Item trailer. Preserve user pins, other work, experimental defaults and unrelated behavior. Do not merge PRs, repair parked Wave 2, duplicate completed findings 8/2/3, or implement unrelated parity work. Identify scripted/mocked fixtures separately from live CLI/browser evidence."
acceptanceCriteria:
  - "Retain both rename endpoints separately from the display label. Rendered recovery commands safely operate on the whole rename or explain why that action is unavailable."
  - "No offered action creates a source-only deletion commit, removes an unmatched endpoint, or performs a partial stash. Preserve ordinary non-rename recovery and baseline-untracked handling."
  - "Use real disposable Git regressions for R and RM, quoted and arrow-containing names, .rex and .ndx/rex layouts, and unrelated staged/dirty files. Report unsupported Git/OS/interactive behavior as untested."
priority: "high"
run: {"tier":"heavy","models":{"codex":"gpt-6-astra"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6-astra"},"reviewOptional":false,"skipTestGate":false,"contextNotes":"Approved by the user on 2026-11-12 for the existing seven-PR Wave 1 stack, rebased on main 6f72df28b0319174cb600eb67d94327d0377ed7f. Execute this repair through actual checkout-local ndx work, not direct coordinator edits. Use the configured absolute bundled Codex CLI, mandatory Codex self-review and test gate, scoped patch changesets where applicable, and an atomic code/PRD completion commit with a bare N-DX-Item trailer. Preserve user pins, other work, experimental defaults and unrelated behavior. Do not merge PRs, repair parked Wave 2, duplicate completed findings 8/2/3, or implement unrelated parity work. Identify scripted/mocked fixtures separately from live CLI/browser evidence."}
source: "ndx-capture"
blockedBy:
  - "eec4aad9-ae82-4196-978f-6dffb44c2a5e"
---
