---
id: "cb66f14c-474a-4f45-8214-0255c3ef1cbc"
level: "feature"
title: "Claims hardening"
status: "pending"
priority: "high"
tags:
  - "0.7.1"
  - "claims-hardening"
source: "caos work management: feature ndx 0.7.1 - Claims hardening"
acceptanceCriteria:
  - "After a refused completion the task stays claimed; a second worktree's ndx work skips it; ndx claim --release frees it (tests)."
  - "The dashboard next-task read and Execute agree on a tree with a live foreign claim (test)."
  - "Recovery commands printed after a refusal are limited to the paths the run touched."
  - "A claim lost to another worktree mid-run is visible in the Sessions tray."
description: "Cross-worktree task claims shipped in 0.7.0 with known gaps. When the uncommitted-work gate refuses to mark a task complete, the claim is released even though recoverable work sits in the first worktree, so a second worktree can claim and redo the task. The dashboard's next-task suggestion does not skip live claims, so it can suggest a task that Execute then rejects with a 409. After a refusal the CLI offers recovery commands that are not scoped to the paths the run touched. Hold the claim on refusal with an expiry and add ndx claim --release as the escape hatch; make the dashboard read skip live claims; offer only validated, path-scoped recovery commands; show a claim taken over by another worktree mid-run in the Sessions tray. Related rex tasks: cbc45de5 (hold on refusal), f9e70688 (dashboard read), db80edad (recovery commands).\n\nGoal: Two worktrees never do the same task twice, and what the dashboard suggests is what it will run."
lastModified: "2026-09-21T17:24:07.773Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Add ndx claim to list and release cross-worktree task claims](./add-ndx-claim-to-list-and-release.md) | in_progress |
| [Hold the task claim when the uncommitted-work gate refuses completion](./hold-the-task-claim-when-the.md) | in_progress |
| [Make the dashboard next-task read skip live claims so it matches Execute](./make-the-dashboard-next-task-read-skip.md) | pending |
| [Offer only validated, path-scoped recovery commands after an uncommitted-work refusal](./offer-only-validated-path-scoped.md) | pending |
| [Surface a claim lost mid-run in the Sessions tray](./surface-a-claim-lost-mid-run-in-the.md) | in_progress |
