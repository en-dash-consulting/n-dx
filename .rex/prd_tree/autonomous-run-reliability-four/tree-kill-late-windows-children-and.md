---
id: "1620e4cd-78b8-4835-82b4-14fd54cc3a45"
level: "task"
title: "Tree-kill late Windows children and their descendants"
status: "completed"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:high"
  - "windows"
  - "process-lifecycle"
source: "ndx-adversarial-review"
startedAt: "2026-09-14T14:37:14.118Z"
completedAt: "2026-09-14T14:59:43.869Z"
endedAt: "2026-09-14T14:59:43.869Z"
acceptanceCriteria:
  - "A child registered after cleanup begins follows the same bounded terminateTree contract on Windows rather than receiving only a direct child.kill call."
  - "A real Windows test starts a late child that starts a grandchild and proves both PIDs have exited within a bounded deadline."
  - "The late-arrival cleanup keeps its POSIX behavior and the focused core child-lifecycle suite passes."
  - "A patch changeset for @n-dx/core is included."
description: "PR #370 review found that child-lifecycle.js falls back to child.kill() for a child registered after cleanup begins on Windows. That kills only the direct process and can leave a pnpm or shell grandchild alive, violating the terminateTree contract through the global CLI tracker. Use a bounded Windows tree-kill path for late arrivals and prove it with a real Windows child-plus-grandchild test."
lastModified: "2026-09-14T14:59:44.170Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
