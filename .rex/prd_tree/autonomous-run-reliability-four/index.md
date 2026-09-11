---
id: "fc1b9f67-17e9-45db-a9d1-fc1e865f97ba"
level: "epic"
title: "Autonomous run reliability: four defects found running wave 1"
status: "pending"
priority: "critical"
tags:
  - "reliability"
  - "release-0.6.0"
  - "hench"
  - "rex"
source: "GitHub issues #362-#365, filed from the wave-1 session 2026-09-11"
acceptanceCriteria:
  - "A run that repeats an identical failing tool call is stopped rather than looping indefinitely (#362)."
  - "A task cannot reach status completed while its work sits uncommitted (#363)."
  - "An epic does not auto-complete while any child is deferred, blocked or failing (#364)."
  - "`--reset-deferred` can actually start the run it enables, and a refusal exits non-zero (#365)."
description: "All four were hit while producing the 0.6.0 wave-1 PRs (#359, #360, #361, #366) and are filed as GitHub issues #362, #363, #364 and #365. Each is independent; fix them in one PR off main.\n\nWhy before the release: 0.6.0 is the release that makes concurrent checkouts safe, which is an invitation to run more autonomous work in parallel. These four defects all make autonomous runs unreliable, and #363 silently loses completed work while reporting success.\nConventions: cross-package imports go through the gateway modules; hench must not import node:child_process (tests/e2e/architecture-policy.test.js enforces it). Add a changeset with scoped package names. Run `pnpm test` from the repo root before declaring done."
lastModified: "2026-09-11T18:56:17.272Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Do not auto-complete an epic that still has deferred, blocked or failing children](./do-not-auto-complete-an-epic-that.md) | deferred |
| [Refuse to mark a task completed while its work is uncommitted](./refuse-to-mark-a-task-completed-while.md) | completed |
| [--reset-deferred must be able to start the run it enables, and a refusal must exit non-zero](./reset-deferred-must-be-able-to-start.md) | pending |
| [Stop a run that repeats an identical tool call instead of letting it loop forever](./stop-a-run-that-repeats-an-identical.md) | pending |
