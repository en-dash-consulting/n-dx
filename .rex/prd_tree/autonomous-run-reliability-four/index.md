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
startedAt: "2026-09-11T22:32:16.148Z"
endedAt: "2026-09-12T00:38:03.561Z"
acceptanceCriteria:
  - "A run that repeats an identical failing tool call is stopped rather than looping indefinitely (#362)."
  - "A task cannot reach status completed while its work sits uncommitted (#363)."
  - "An epic does not auto-complete while any child is deferred, blocked or failing (#364)."
  - "`--reset-deferred` can actually start the run it enables, and a refusal exits non-zero (#365)."
description: "All four were hit while producing the 0.6.0 wave-1 PRs (#359, #360, #361, #366) and are filed as GitHub issues #362, #363, #364 and #365. Each is independent; fix them in one PR off main.\n\nWhy before the release: 0.6.0 is the release that makes concurrent checkouts safe, which is an invitation to run more autonomous work in parallel. These four defects all make autonomous runs unreliable, and #363 silently loses completed work while reporting success.\nConventions: cross-package imports go through the gateway modules; hench must not import node:child_process (tests/e2e/architecture-policy.test.js enforces it). Add a changeset with scoped package names. Run `pnpm test` from the repo root before declaring done."
lastModified: "2026-09-12T03:18:51.839Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [A review pass that could not run must not report a completed, reviewed task](./a-review-pass-that-could-not-run-must.md) | completed |
| [Calibrate the uncommitted-work guards: discount hench's own PRD writes and the tree-meta sidecar, and cover --epic-by-epic](./calibrate-the-uncommitted-work-guards.md) | completed |
| [CI child-cleanup fixtures are never reaped and accumulate across suite runs](./ci-child-cleanup-fixtures-are-never.md) | completed |
| [Cleanup from the #370 review: dedupe the adapter stamping block, share the porcelain path matcher, align next-task wording](./cleanup-from-the-370-review-dedupe-the.md) | completed |
| [Codex file_change event shape is unverified, so the livelock progress fix can silently not work](./codex-file-change-event-shape-is.md) | pending |
| [Completion must not cascade over an explicit in_progress parent, or outside the run's subtree](./completion-must-not-cascade-over-an.md) | completed |
| [Do not auto-complete an epic that still has deferred, blocked or failing children](./do-not-auto-complete-an-epic-that.md) | completed |
| [Finalize gate must discount only what the commit prompt will actually commit: staged work only with a pending message, reviewer repairs on both paths](./finalize-gate-must-discount-only-what.md) | completed |
| [Late-arrival child kill is proven only against a fake, and the e2e guard that would catch it only trips under load](./late-arrival-child-kill-is-proven-only.md) | pending |
| [Livelock detector must see Codex file edits as progress](./livelock-detector-must-see-codex-file.md) | completed |
| [Lock file is readable while empty, so a second writer can reclaim a live lock](./lock-file-is-readable-while-empty-so-a.md) | pending |
| [PRD tree snapshot must tolerate a concurrent writer's temp files](./prd-tree-snapshot-must-tolerate-a.md) | completed |
| [Refuse to mark a task completed while its work is uncommitted](./refuse-to-mark-a-task-completed-while.md) | completed |
| [--reset-deferred must be able to start the run it enables, and a refusal must exit non-zero](./reset-deferred-must-be-able-to-start.md) | completed |
| [--reset-deferred must commit only its own writes and must not write on --dry-run](./reset-deferred-must-commit-only-its.md) | completed |
| [rex fix must reopen parents to pending (not in_progress) and run the whole-tree stuck-parent sweep](./rex-fix-must-reopen-parents-to-pending.md) | completed |
| [Stop a run that repeats an identical tool call instead of letting it loop forever](./stop-a-run-that-repeats-an-identical.md) | completed |
| [Withdrawing a completion must reopen the ancestors the agent's own cascade already closed](./withdrawing-a-completion-must-reopen.md) | completed |
