---
id: "eec4aad9-ae82-4196-978f-6dffb44c2a5e"
type: "task"
title: "Preserve cross-boundary renames during interactive PRD rollback"
slug: "preserve-cross-boundary-renames-during"
description: "PR #1004 review comments 4554547171: https://github.com/en-dash-consulting/n-dx/pull/1004#discussion_r4554547171. Cross-reference 181fe90f-cf21-4fce-9569-fb7fe52ed4c6, bc98e476-b15f-4b1d-9b24-352ca15bcf6b, 93871c16-aeb7-4027-9b76-0054a992ba41. Approved by the user on 2026-11-12 for the existing seven-PR Wave 1 stack, rebased on main 6f72df28b0319174cb600eb67d94327d0377ed7f. Execute this repair through actual checkout-local ndx work, not direct coordinator edits. Use the configured absolute bundled Codex CLI, mandatory Codex self-review and test gate, scoped patch changesets where applicable, and an atomic code/PRD completion commit with a bare N-DX-Item trailer. Preserve user pins, other work, experimental defaults and unrelated behavior. Do not merge PRs, repair parked Wave 2, duplicate completed findings 8/2/3, or implement unrelated parity work. Identify scripted/mocked fixtures separately from live CLI/browser evidence."
acceptanceCriteria:
  - "A staged src-to-PRD rename with dirty PRD state retains the target and every staged and unstaged post-move byte when interactive rollback is accepted; the prompt accurately states the rollback scope and protected user work."
  - "Real disposable Git regressions cover R and RM states, quoted and arrow-containing paths, both .rex and .ndx/rex layouts, unrelated staged and dirty work, baseline-untracked files and ordinary PRD rollback."
  - "Noninteractive execution still refuses rollback rather than deleting user work. Keep this Hench guard repair separate from parked Web rollback finding 1 in #1016."
  - "Document observed Git behavior precisely: Git 2.43.2/helper fixtures confirmed target loss; source-only stash duplication was not reproduced and must not be asserted as an observed outcome."
priority: "high"
run: {"tier":"heavy","models":{"codex":"gpt-6-astra"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6-astra"},"reviewOptional":false,"skipTestGate":false,"contextNotes":"Approved by the user on 2026-11-12 for the existing seven-PR Wave 1 stack, rebased on main 6f72df28b0319174cb600eb67d94327d0377ed7f. Execute this repair through actual checkout-local ndx work, not direct coordinator edits. Use the configured absolute bundled Codex CLI, mandatory Codex self-review and test gate, scoped patch changesets where applicable, and an atomic code/PRD completion commit with a bare N-DX-Item trailer. Preserve user pins, other work, experimental defaults and unrelated behavior. Do not merge PRs, repair parked Wave 2, duplicate completed findings 8/2/3, or implement unrelated parity work. Identify scripted/mocked fixtures separately from live CLI/browser evidence."}
source: "ndx-capture"
---
