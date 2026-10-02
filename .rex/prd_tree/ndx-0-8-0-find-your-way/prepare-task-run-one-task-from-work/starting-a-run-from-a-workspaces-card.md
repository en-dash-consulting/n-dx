---
id: "3670035e-1f7d-4fe6-ae27-4e34dfd47a88"
level: "task"
title: "Starting a run from a Workspaces card opens Live in the viewer's workspace, not the card's"
status: "pending"
priority: "high"
tags:
  - "0.8.0"
  - "task-prep"
  - "ndx-adversarial-review"
  - "severity:high"
  - "web-viewer"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "Starting from a Workspaces card for another worktree navigates to /w/<key>/live/task/<id> (with the /p/<id>/ prefix when behind the hub); a test covers started and queued paths."
  - "Starting from the viewer's own workspace still navigates in-app to /live/task/<id>."
description: "Verdict: must-fix (introduced; the user lands on 'no runs in this worktree' after a successful start).\n\nScenario: from the anchor, open Workspaces, press Start working on the card for worktree `feature`, then Execute. The run starts in `feature` (the request carries X-Ndx-Workspace), but openLive (components/start-task-button.ts:148-153) navigates to appUrl('/live/task/<id>') — the anchor's URL — and views/live-task.ts reads /api/live/task/:id for the viewer's own worktree. The queued notice's 'Open in Live' link (prepare-task-modal.ts:566) has the same bug. Caller: views/workspaces.ts:528 passes `workspace` but no navigateTo.\n\nFix (recommended): when `workspace` is set, build the URL from the hub base plus /w/<key>/live/task/<id> (as workspaceViewUrl does) and do a full navigation; pass the same href to the modal for the queued link."
lastModified: "2026-10-02T07:47:27.018Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
