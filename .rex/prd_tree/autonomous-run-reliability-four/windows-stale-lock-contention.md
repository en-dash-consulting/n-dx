---
id: "baf53d27-a211-4930-a692-51f2fd60f11e"
level: "task"
title: "Windows stale-lock contention regression test can deadlock"
status: "pending"
priority: "high"
tags:
  - "windows"
  - "rex"
  - "ci-smoke"
source: "ndx-capture"
acceptanceCriteria:
  - "The stale-lock contention regression test completes on Windows without timing out and without relying on alternate spellings of the same lock path to schedule two readers."
  - "The test deterministically proves that a contender which observes a dead generation cannot unlink a subsequently published live replacement lock."
  - "The regression test fails against the unsafe path-based stale-lock reclamation behavior it was created to prevent."
  - "The focused Rex lock tests and the Windows CLI Smoke suite pass."
description: "Windows CLI Smoke began failing at commit 5fca26c after this PR added packages/rex/tests/unit/store/file-lock-stale-contention.test.ts. The test intentionally blocks each contender after it reads a stale lock and releases the barrier only when two stale reads occur. On Windows the assumed two-reader ordering is not reached, so one contender remains blocked and Vitest times out after 30 seconds. This is a test synchronization failure, not permission to weaken the stale-lock safety behavior. Replace the platform-sensitive path-alias/barrier setup with deterministic coordination that proves a replacement live lock is never unlinked, terminates on Windows, and still fails against unsafe reclamation."
lastModified: "2026-09-13T03:29:45.797Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
