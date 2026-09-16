---
id: "b2b788c6-d4ca-4b68-81c8-00295ce715a3"
level: "task"
title: "Renew task claims throughout a live run"
status: "pending"
priority: "high"
tags:
  - "pr-06"
  - "claims"
  - "rex"
  - "hench"
  - "ndx-adversarial-review"
  - "severity:high"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A task claim held by a still-running process remains exclusive past its original TTL through periodic renewal."
  - "Claim renewal stops when the run releases or otherwise finalizes its claim."
  - "Dead-process and expired claims remain reclaimable, preserving stale-claim recovery."
  - "A deterministic test proves a live claim cannot be selected by a second worktree after the initial TTL would otherwise have elapsed."
description: "Severity: high. Verdict: must-fix. `packages/rex/src/store/claims.ts` considers a claim live only when both its PID is alive and `expiresAt` is in the future. The store can renew a claim by calling `claim()` again, but the run lifecycle acquires only during brief preparation and never renews. A local or unlimited-timeout run exceeding the four-hour default TTL becomes selectable by another worktree despite its original process still working, causing duplicate execution. Start a lifecycle-owned heartbeat at a safe fraction of the TTL, stop it on release/finalization, and add deterministic long-running exclusivity coverage."
lastModified: "2026-09-16T14:25:18.699Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
