---
id: "32083905-0bb8-4bd3-baf5-7ea6a93daf16"
level: "task"
title: "Unmount preact harnesses so the frame-fallback timer cannot outlive jsdom"
status: "pending"
priority: "high"
tags:
  - "testing"
  - "flake"
  - "web"
source: "Adversarial review finding F6 from hench run 6210cfa5-351e-4ff8-9096-d516e97995df (WM2090, 2026-09-22). Classified out-of-scope for that change and dropped; add_item was not permitted in that run's environment, so it went uncaptured. Captured by hand afterwards."
acceptanceCriteria:
  - "Viewer hook tests unmount their harness and flush preact's scheduled work in afterEach, rather than declaring requestAnimationFrame/cancelAnimationFrame globals in setup."
  - "The sibling viewer hook tests are audited for the same render-without-unmount shape, and the ones that have it are fixed in the same pass."
  - "Repeated runs of the @n-dx/web suite under load do not produce an uncaught cancelAnimationFrame ReferenceError."
  - "A suite that reports every test passed cannot also exit non-zero from a post-teardown timer in these files."
description: "A preflight of the @n-dx/web suite failed with \\\"265 files passed, 3976 tests passed, Errors 1 error\\\" — an uncaught ReferenceError: cancelAnimationFrame is not defined, thrown from preact/hooks via listOnTimeout. This is the worst shape of failure: the suite goes red while its own summary reports that everything passed, so the signal a reader trusts and the exit code disagree.\n\nMechanism: preact's afterNextFrame schedules both a requestAnimationFrame callback and a 100ms setTimeout fallback. When a test file finishes inside the roughly 16ms rAF window, jsdom is torn down first and the surviving fallback timer fires in a plain node context where cancelAnimationFrame does not exist. It is load- and order-dependent — packages/web/tests/unit/viewer/use-polling-suspension.test.ts passes alone (6/6 in 440ms) and the suite passed on a re-run — which is why it reads as a flake rather than a defect.\n\nFix direction, from the review: unmount the harness in afterEach and flush preact's scheduled work, rather than defining requestAnimationFrame/cancelAnimationFrame as globals in test setup. Defining the globals hides the leak instead of closing it — the timer still fires after teardown, it just no longer throws, which converts a loud failure into a silent one. Audit the other viewer hook tests for the same render-without-unmount shape before patching a single file; the review saw no reason to believe use-polling-suspension.test.ts is the only one, it is just the one that lost the race that day.\n\nImplementation notes: start at packages/web/tests/unit/viewer/use-polling-suspension.test.ts and grep the sibling viewer hook tests for renders with no matching unmount. The n-dx constraint set applies: every user-facing change carries a changeset using the scoped package name with a patch bump, though a test-only change may not warrant one; run pnpm preflight before opening the PR."
lastModified: "2026-09-22T23:43:34.629Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
