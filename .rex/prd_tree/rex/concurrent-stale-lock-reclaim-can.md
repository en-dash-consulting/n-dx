---
id: "063f2600-ce36-40d6-b278-7a4e4a580137"
level: "task"
title: "Concurrent stale-lock reclaim can unlink a replacement live lock"
status: "pending"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:high"
source: "ndx-adversarial-review"
startedAt: "2026-09-12T23:15:40.455Z"
acceptanceCriteria:
  - "A deterministic multiprocess or injected-filesystem test schedules two contenders after the same dead lock is observed, and it proves that no contender can unlink a replacement lock with a different live ownership token"
  - "For a stale lock contended by two processes, at most one process enters the protected callback at a time and both writers either serialize or fail loudly without losing either write"
  - "The stale-reclaim implementation contains no check-then-unlink-by-path window that can act on a different lock generation than the one whose liveness was checked"
  - "Existing live-lock timeout, normal acquisition, release ownership, and crashed-writer recovery behavior is either preserved or the intentional manual-recovery tradeoff is documented and tested"
description: "Severity: high. Verdict: out-of-scope — this race predates task a63d1345 and is not introduced by atomic lock publication.\n\nFailure scenario: begin with a lock whose PID is dead. Processes B and C both fail exclusive publication and both read that same lock in isLockStale, receiving true. B unlinks the stale file and publishes its own live lock. C then executes the unconditional unlink at packages/rex/src/store/file-lock.ts in acquireLock, removing B live replacement rather than the stale generation C inspected. C publishes its own lock, so both processes return success and enter the PRD critical section. A later full-tree save can lose data or trigger the stale-save guard.\n\nReachability: every Rex store mutation and CLI transaction reaches acquireLock; the trigger is two writers contending immediately after a crashed writer leaves a stale lock. The in-process queue cannot guard different processes, and releaseIfOwner protects only release, not stale cleanup.\n\nSolution options: (1) Recommended safety-first fix: stop automatically unlinking dead or malformed locks and fail with the existing operator guidance, trading post-crash manual cleanup for strict mutual exclusion. Small change and low correctness risk, but reduced automatic recovery. (2) Replace the lock with a kernel-backed cross-platform advisory-lock implementation whose ownership is released on process death. Larger dependency and platform-validation cost, but preserves automatic recovery. (3) Design a fenced generation/reclaim protocol in which a holder must prove ownership at commit time. Largest change and touches store transactions, but can retain automatic recovery without trusting a check-then-unlink sequence."
lastModified: "2026-09-12T23:30:21.400Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
