---
id: "f1581c8a-8539-4841-af58-122966c300d3"
level: "task"
title: "Reverting a product edit leaves a completed but unapplied draft able to write the abandoned spec"
status: "completed"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-10"
  - "rex"
source: "ndx-adversarial-review"
startedAt: "2026-10-08T04:10:30.717Z"
completedAt: "2026-10-08T04:21:55.784Z"
endedAt: "2026-10-08T04:21:55.784Z"
resolutionType: "code-change"
resolutionDetail: "product-edit: completed but unapplied drafts are never modified; result.stale names them. Revert of a revised node returns \"reverted\" with stale; apply refuses the stale draft via its base (edited spec hash). Result field `change` replaced by `drafts` + `stale`."
acceptanceCriteria:
  - "Editing met A1.1 A→B, completing the draft without applying it, then editing B→A, does not return outcome \"unchanged\" silently: the result names the completed draft (test)"
  - "Applying that completed draft after the revert does not leave A1.1 at B without a warning or refusal (test)"
description: "Verdict: should-fix. Found reviewing 73a63ca4 (commit f1f39f482).\n\nScenario: A1.1 is met at A. The steward edits it to B, which drafts change 1 proposing B. Change 1's work is completed, but it is not applied yet (rex.applyOn review or release). The steward then edits B back to A. handleProductEdit (packages/rex/src/core/product-edit.ts, the `atMet && !openDraft(...)` early return) finds no open draft, because openDraft uses isOpenChange and completed is closed, so it returns \"unchanged\". applyAmendments (core/apply-amendments.ts) refuses only cancelled and deleted changes, so applying change 1 later writes B over A and the revert is lost. The planned Amendment.base refusal in 8cfdb939 does not catch this: the base is A's hash, which is also the node's current hash after the revert.\n\nReachable once handleProductEdit is wired to a CLI or MCP path and applyOn is not \"complete\". Nothing reaches it today.\n\nOptions:\n(a) In the revert path, also look for completed but unapplied product-edit drafts that amend the node, and report them in the result, e.g. as a \"stale\" list, so the caller or steward decides. Cheap. The code should not reopen or cancel completed work on its own.\n(b) At apply time, refuse a product-edit amendment whose proposed spec equals neither the node's current spec nor a newer one, when the node is at its base. Needs a new rule in apply.\nRecommend (a), because the decision belongs to the steward.\n\nDecision (2026-10-07, Ryan): option (a). In the revert path, find product-edit drafts that are completed but not applied and amend the node, and report them in the result as stale, so the caller or steward decides; do not reopen or cancel completed work. The same run also does 8967d9cb (option a: handle every open product-edit draft for the node, on revert and on refresh). Runs after PR 30 (#580) is merged into this branch, using the shared isAppliedChange and isOpenChange from schema/v2-rules.ts.\n\nUpdate (2026-10-07): since PR 30 (merge a5d52f82d) and the adapt task (28f38ab5a), isOpenChange counts a completed but unapplied draft as open, so the revert path now withdraws it: its amendment is dropped and it stays completed with a cancelled intent note. This task must restore the decision above: a revert reports such a draft as stale and does not modify it. The same run also does 7546b066 (option a: the refresh path does not refresh a completed draft; it drafts a new change and reports the completed one as stale) and 8967d9cb."
lastModified: "2026-10-08T04:21:56.913Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
