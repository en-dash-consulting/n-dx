---
id: "f21cf509-f646-454c-bb66-4b80ac6c9bdc"
level: "task"
title: "rex release stamp applies a container change before the changes nested in it"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "rex"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "changesAwaitingApply returns a nested change before the change that holds it (test)"
  - "rex release stamp under applyOn release applies a nested change before its container, and the container's amendment is the one left on the product layer when both amend the same capability (test)"
  - "A steward apply of a container whose nested change is unapplied is refused, naming the nested change (test)"
description: "Found reviewing da3ca62b (run 2192733d). Verdict: out-of-scope (pre-existing in apply-policy / release-stamp; not introduced by da3ca62b). Severity medium.\n\nFailure scenario: v2 tree, rex.applyOn: release. Change OUTER holds nested change INNER; both complete (da3ca62b now completes OUTER with INNER and leaves it unapplied, reason \"change INNER is not applied\"). `rex release stamp <v>` (run by the root version-packages script) calls planReleaseStamp, which applies every change in changesAwaitingApply(tree) in order. changesAwaitingApply (packages/rex/src/core/apply-policy.ts:93) visits depth-first pre-order: it pushes a change before its children, so OUTER is applied before INNER. If both amend the same capability, OUTER's amendment lands first and INNER's overwrites it (or INNER's `base` check refuses and the whole stamp fails). This breaks the rule da3ca62b established for applyOn complete: a container applies after its nested changes. A steward apply (trigger \"steward\") of OUTER is likewise unguarded.\n\nReachability: `rex release stamp` on any v2 tree under applyOn release with a nested change (move_item allows change under change).\n\nOptions:\n1. Recommended: make changesAwaitingApply post-order (push a change after visiting its children), so inner changes apply first; add a guard in applyOnTrigger (or applyAmendments) that refuses a container whose live nested change is unapplied, sharing the predicate closeChange in core/change-completion.ts uses. Cost: small, plus tests. Risk: release stamp output order changes.\n2. Only switch to post-order. Cheaper, but a steward apply of a container stays unguarded."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T09:52:46.126Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
