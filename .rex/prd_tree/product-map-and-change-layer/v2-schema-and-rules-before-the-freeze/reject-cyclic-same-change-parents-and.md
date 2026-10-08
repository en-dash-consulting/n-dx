---
id: "494ec070-30e1-4345-bcc6-520da88b7bdb"
level: "task"
title: "Reject cyclic same-change parents and wrong-kind references in the v2 rules"
status: "in_progress"
priority: "high"
startedAt: "2026-10-08T00:51:56.659Z"
acceptanceCriteria: []
description: "From the review of PR #580 (two P2 inline comments on packages/rex/src/schema/v2-rules.ts, refResolves). Both let the pre-freeze validator certify a plan that cannot be realized. Separate from the deferred cross-change stacked-add decision (a55c7225, option b).\n\n1. Same-change addition parents. refResolves accepts an added amendment's under when it names any node the same change adds (added.has(a.under)), without proving the additions form a tree. Reproduced: a single added amendment with target new-a and under new-a returns no findings from all of checkV2Rules on an empty product layer; two additions new-a under new-b and new-b under new-a also return none. layer-nesting and capability-depth only walk materialized nodes. Fix: for an unapplied change, build the graph of its added amendments (target -> under) and report a self-parent or a cycle as an error naming the amendments; then treat a same-change parent as resolved only when the chain reaches an existing node or the layer root.\n\n2. Destination kind. refResolves only checks that a reference resolves in either layer. Reproduced: a change whose child task has id task-1, with touches [task-1] and an added capability under task-1, returns no findings. Fix: field-specific destination checks beside the existence check, keeping today's tombstone and alias handling. touches, modified and removed amendment targets, an added amendment's under, and appliesTo must name a product-layer node; dependsOn must name a capability; blockedBy must name a change-layer node; an added amendment's under must be a node that can hold the added type under the existing layer-nesting rules (area or capability for a capability). Report as errors naming the field, the reference and the kind found.\n\nRegression tests for both reproductions and for each wrong-kind field. Stay in schema/v2-rules.ts and its tests. Patch changeset for @n-dx/rex."
lastModified: "2026-10-08T00:51:56.912Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
