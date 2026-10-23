---
id: "5d638580-71e0-480b-947e-e26268977650"
type: "change"
title: "\"Stop all\" on /live is enabled by the repository-wide count but stops only the served worktree's runs"
slug: "stop-all-on-live-is-enabled-by-the"
intent: "Failure: `packages/web/src/viewer/views/live.ts:115,128` enables Stop all from the repository-wide running count. When everything running is in other worktrees, the button is enabled, the confirm dialog appears and the notice says \"Stopped\" although nothing stopped.\n\nVerdict: should-fix (severity low).\n\nOptions:\n- Recommended: count only runs whose worktree is the served one (`worktree.isServed`) and say in the dialog that other worktrees' runs are not affected. Small."
acceptanceCriteria:
  - "Stop all is disabled when no run is live in the served worktree (unit test)."
  - "The confirm dialog names how many runs in this worktree will be stopped."
touches:
  - "ba50eaa7-5f31-4a8d-9e16-6c452882022e"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "live"
source: "ndx-adversarial-review"
---
