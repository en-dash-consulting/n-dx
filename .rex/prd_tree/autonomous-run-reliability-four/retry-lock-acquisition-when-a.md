---
id: "8ba9c8fa-3cd8-40a2-bb30-f5684f1c9ad2"
level: "task"
title: "Retry lock acquisition when a contending lock vanishes during inspection"
status: "pending"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:high"
  - "rex"
  - "lock"
source: "ndx-capture"
startedAt: "2026-09-14T17:27:31.390Z"
acceptanceCriteria:
  - "If a lock publication conflict is followed by the lock path disappearing before state inspection, acquisition retries instead of classifying the absent path as malformed or waiting for the full timeout."
  - "A live file lock and an initializing directory-backed lock remain contended and are never unlinked or stolen by this recovery path."
  - "A deterministic interleaving test proves the EEXIST-to-absent race is retried, and concurrent import-bundle coverage completes without a lock-timeout failure."
  - "Focused Rex lock tests and the concurrent import-bundle integration test pass, with a patch changeset for @n-dx/rex."
description: "PR #370 Build & Validate fails in concurrent import-bundle coverage because a contender can observe EEXIST, then the winning lock is released before state inspection. The read is decoded as malformed or unknown and the acquirer waits until timeout instead of retrying acquisition. Treat disappearance between publication conflict and inspection as a retryable acquisition race; preserve the safety rule that a live or initializing lock is never stolen. Add deterministic interleaving coverage and restore the concurrent import-bundle test."
lastModified: "2026-09-14T17:42:47.093Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
