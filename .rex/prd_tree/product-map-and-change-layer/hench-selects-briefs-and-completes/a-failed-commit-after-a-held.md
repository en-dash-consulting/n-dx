---
id: "16197f3e-5d24-4a8b-aa2c-3edbca2923d8"
level: "task"
title: "A failed commit after a held completion must not reopen an applied v2 change"
status: "pending"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-35"
  - "lane-hench"
  - "hench"
  - "review-2026-10-12"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "On a v2 copy, a held completion that applied a change, followed by an agent commit rejected by a failing pre-commit hook, leaves the task and change completed and applied (appliedAt kept, product/ amendment kept), and the run fails naming the uncommitted paths and how to commit them (test that fails on 676ed8eb27)"
  - "The same holds for the review-repair staging and review-repair commit failures, and for a bypassed completion withdrawn after a failed gate (tests)"
  - "A withdrawn completion that applied nothing still resets as today; v1 withdraw behaviour is unchanged and existing tests pass unedited"
description: "Review 2026-10-12, PR #692 should-fix 1 (CONFIRMED by the subagent's reproduction, scratchpad/pr692/reopen-script.mjs). This item was filed by the adversarial review of 44043b84 for the bypassed completion only; the review found the normal held flow reaches it too, and that this PR (not pre-existing code) makes it reachable, because before it hench on v2 never applied a change (c1c8888b).\n\nDecision S1-Q2 (Ryan, 2026-10-12): never reopen a change applied in this run. Keep the completion, fail the run with the uncommitted paths listed, and say how to commit them. Do not revert the amendment.\n\nDefect: packages/hench/src/tools/rex.ts:129 (completeOnV2) applies the change when the last task completes. Every later failure path calls withdrawCompletionClaim (packages/hench/src/agent/lifecycle/shared.ts:3272-3303), which resets the task and, through reopenWithdrawnAncestors (:3217), runs the v1 findParentResets over the projection and sets the change back to pending. ChangeLayerStore.updateItem has no guard against reopening an applied change, so the product layer keeps the amendment.\n\nFailure scenario (normal held flow):\n1. `ndx work` on a v2 tree. The agent asks to complete, rex holds the completion, and the test gate passes.\n2. updateCompletedTaskStatus (shared.ts:4171) runs completeV2Work. The task and change are completed, and \"Apple Pay is offered on Safari\" is written into product/.\n3. A later step fails and calls withdrawCompletionClaim: the agent's git commit (e.g. a pre-commit hook rejects it) at shared.ts:3155, review-repair staging at :2954, or the review-repair commit at :4229. (The bypassed-completion gate failure in finalizeRun is a fourth path.)\n4. The task is pending and the change is pending, but the change still carries appliedAt and appliedAmendsHash and product/ still holds the criterion.\n5. The dirty product/ and changes/ are discounted as bookkeeping, so the next completion commit sweeps them in (1672bb20); if the work is abandoned, the product layer keeps a phantom amendment.\n\nFix: on v2, when the completion being withdrawn applied a change in this run (or the change is applied), do not reset the task or its change. Keep the completion, fail the run, and report the uncommitted paths with the commands to commit them (naming the task's N-DX-Item trailer). A withdraw of a completion that applied nothing keeps today's behaviour. v1 is unchanged."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T18:22:33.839Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
