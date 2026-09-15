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
  - "An incomplete directory-backed fallback lock remains contended and reports that publication is in progress rather than becoming an unknown stale holder."
  - "The six lock failures from CI run 35000812304 pass, including stale/dead/malformed manual-cleanup cases and fallback publication diagnostics."
description: "Merge regression on PR #370: merge c6f24499 reintroduced automatic stale-lock reclamation from main, replacing this task's accepted safety-first manual-cleanup design. CI run 35000812304 now fails six Rex lock regressions: stale/dead/malformed locks are reclaimed when they must fail loudly, and an incomplete directory fallback loses its in-progress publication diagnostic. Restore the established safe behavior without weakening atomic publication or release ownership checks."
lastModified: "2026-09-15T17:59:32.738Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
