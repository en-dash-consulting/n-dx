---
id: "1620e4cd-78b8-4835-82b4-14fd54cc3a45"
level: "task"
title: "Tree-kill late Windows children and their descendants"
status: "pending"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:high"
  - "windows"
  - "process-lifecycle"
source: "ndx-adversarial-review"
startedAt: "2026-09-14T14:37:14.118Z"
acceptanceCriteria:
  - "A child registered after cleanup begins follows the same bounded terminateTree contract on Windows rather than receiving only a direct child.kill call."
  - "A real Windows test starts a late child that starts a grandchild and proves both PIDs have exited within a bounded deadline."
  - "A real `ndx ci` SIGINT integration test on Windows proves every tracked fixture child and descendant is reaped; it fails if `docs:build` remains alive after the shutdown deadline."
  - "The late-arrival cleanup keeps its POSIX behavior and the focused core child-lifecycle suite passes."
  - "A patch changeset for @n-dx/core is included."
description: "PR #370 adversarial review found that child-lifecycle.js used child.kill() for a child registered after cleanup began on Windows, killing only the direct process and potentially leaving pnpm or shell descendants alive. The first repair passed focused tests and marked this task complete, but Windows CI run 34861478322 disproved the completion claim: after SIGINT, tests/e2e/cli-ci-child-cleanup.test.js reported the tracked docs:build fixture child still alive after 6500ms. The focused late-arrival test does not cover the real global ndx ci tracker and SIGINT path. Diagnose and fix that integration path using bounded Windows tree kill, then prove no tracked fixture child or descendant survives a real ndx ci SIGINT on Windows."
lastModified: "2026-09-14T16:46:59.534Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
