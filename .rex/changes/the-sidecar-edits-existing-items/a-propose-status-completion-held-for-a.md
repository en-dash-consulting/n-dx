---
id: "d652a3f3-fd0f-4600-8916-9fc69685f0e2"
type: "task"
title: "A propose_status completion held for a hench run reads as \"Status written.\" on the card"
slug: "a-propose-status-completion-held-for-a"
description: "Scenario: `ndx work` runs task T in this worktree, and its claim holds completion. The operator approves a Sidecar propose_status card moving T to completed. rex's handleUpdateTaskStatus records the completion without writing it and returns a non-error result with completionHeld: true. writeStatusCard (packages/web/src/server/sidecar/status-card.ts, the `if (result.isError)` branch) treats that as ok. The card then shows \"Status written.\" (sidecar-status.ts note) while T is still in_progress until the hench gate passes, so the operator acts on a false claim. The agent's text carries rex's message, so only the card is wrong.\n\nReachable: dashboard Sidecar in the same worktree as a running hench task. Not covered by any test.\n\nOptions:\n- (A, recommended) Parse the result JSON in writeStatusCard. On completionHeld, return ok with a `held` flag (or a distinct text) and have the card say \"Recorded; the hench run applies it after its test gate.\" Cheap.\n- (B) Refuse the card when the item's completion is held. This loses the operator's recorded resolution.\n\nVerdict: should-fix, medium. Found by an adversarial review of 5d52fd20."
acceptanceCriteria:
  - "Approving a propose_status card to completed while a hench run holds the item's completion does not show \"Status written.\" on the card and names the hold (web test)"
  - "The approval's carriedOut result marks the hold distinctly from a written status (web test)"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
