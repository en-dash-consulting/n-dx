---
id: "4cd7c27a-13d3-4fd3-85b4-9f309a4237fd"
level: "feature"
title: "Derived status, health and computed edges"
status: "pending"
priority: "medium"
tags:
  - "product-map"
  - "pr-11"
  - "lane-rex-domain"
  - "rex"
blockedBy:
  - "dc3b80c1-4d3c-486f-ba03-0b6bbe9fd50d"
source: "roadmap"
acceptanceCriteria:
  - "The derived change-stage vocabulary is defined in one place in rex and the web viewer's `ChangeStage` either imports it or is updated to match in the same change; `packages/web/src/viewer/views/product-model.ts`, the Product/Changes/capability views and `packages/web/tests/fixtures/v2-product-map.ts` carry no stage value the engine does not emit."
description: "Capability status and health are derived, never set. Computed edges are cached, never committed.\n\nRoadmap PR 11 · wave 1 · lane rex-domain."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-06T21:23:49.812Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Adapt status, edges and the retired-commits tests to PR 30's schema and rules](./adapt-status-edges-and-the-retired.md) | completed |
| [An open fix: true change that adds a capability marks the new capability defective while its kind is feature](./an-open-fix-true-change-that-adds-a.md) | pending |
| [Compute edges, derived kind and alias resolution](./compute-edges-derived-kind-and-alias.md) | completed |
| [Compute intent status and health for product nodes](./compute-intent-status-and-health-for.md) | completed |
| [computeChangeCommits defaults to the local main branch, which a CI checkout lacks and a worktree may hold stale](./computechangecommits-defaults-to-the.md) | completed |
| [computeChangeCommits returns a truncated commit list from a shallow clone without saying so](./computechangecommits-returns-a.md) | completed |
| [computeProductStatus never marks a node defective for an open fix, because an open change cannot derive kind fix](./computeproductstatus-never-marks-a.md) | completed |
| [computeProductStatus reports a retired node defective from its last failing check](./computeproductstatus-reports-a-retired.md) | pending |
| [Count only started or placed changes as building, and let children follow an amended parent](./count-only-started-or-placed-changes.md) | pending |
| [deriveChangeKind calls a change that adds a new constraint a feature, not a policy change](./derivechangekind-calls-a-change-that.md) | pending |
| [Keep retired nodes visible to status, kind and edges](./keep-retired-nodes-visible-to-status.md) | completed |
| [Match the computed edges to the design: touches, cancelled changes and inherited bindings](./match-the-computed-edges-to-the-design.md) | completed |
| [Re-point recorded commit SHAs that a rebase or squash rewrote](./re-point-recorded-commit-shas-that-a.md) | completed |
| [Warn when a capability's criteria grow past a threshold](./warn-when-a-capability-s-criteria-grow.md) | completed |
| [Work out a change's commits from its N-DX-Item trailers instead of storing them](./work-out-a-change-s-commits-from-its-n.md) | completed |
| [Work out when a change landed from git history](./work-out-when-a-change-landed-from-git.md) | pending |
