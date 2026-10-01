---
id: "5d638580-71e0-480b-947e-e26268977650"
level: "task"
title: "\"Stop all\" on /live is enabled by the repository-wide count but stops only the served worktree's runs"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "live"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "Stop all is disabled when no run is live in the served worktree (unit test)."
  - "The confirm dialog names how many runs in this worktree will be stopped."
description: "Failure: `packages/web/src/viewer/views/live.ts:115,128` enables Stop all from the repository-wide running count. When everything running is in other worktrees, the button is enabled, the confirm dialog appears and the notice says \"Stopped\" although nothing stopped.\n\nVerdict: should-fix (severity low).\n\nOptions:\n- Recommended: count only runs whose worktree is the served one (`worktree.isServed`) and say in the dialog that other worktrees' runs are not affected. Small."
lastModified: "2026-10-01T15:23:19.615Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
