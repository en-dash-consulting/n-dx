---
id: "16197f3e-5d24-4a8b-aa2c-3edbca2923d8"
level: "task"
title: "hench reopens an applied v2 change when it withdraws a bypassed completion"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-35"
  - "lane-hench"
  - "hench"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "On a v2 tree, a bypassed completion withdrawn after a failed gate never sets an applied change back to pending (test)"
  - "The withdraw reports or logs that the change stays completed and applied (test)"
description: "Out-of-scope finding from the adversarial review of 44043b84 (pre-existing code, not introduced by that change). Verdict: out-of-scope, real.\n\nScenario: on a v2 tree the agent's completion bypasses the hold. That happens when the agent uses a rex on PATH built before the hold existed, or the run is outside a git repository. update_task_status completes the task through completeV2Work, which completes its pending change and applies the change's amendments to product/. The test gate then fails. reopenWithdrawnAncestors (packages/hench/src/agent/lifecycle/shared.ts ~3211) runs the v1 findParentResets over the projected change layer and calls store.updateItem(change, {status: \"pending\"}). Either the product layer keeps the applied amendment under a change that is pending again, or the ChangeLayerStore refuses the write with ChangeLayerWriteError and the withdraw half-completes. On v2 there is no unapply.\n\nReachable: finalizeRun → the gate-failure path for completionHold.outcome === \"bypassed\".\n\nOptions:\n(a) On v2, skip the ancestor reset. Report that the change was completed and applied by a bypassed completion, and leave it for the operator. Cheap. Recommended.\n(b) Refuse to withdraw on v2 when the change has applied amendments. Cost similar; it states the conflict explicitly.\n(c) Add a rex unapply. That is out of hench's lane."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T10:41:48.655Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
