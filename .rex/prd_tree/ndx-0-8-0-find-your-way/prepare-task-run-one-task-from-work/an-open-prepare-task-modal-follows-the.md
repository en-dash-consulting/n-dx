---
id: "a4fe7c8d-a82f-4081-8719-50e479a1f753"
level: "task"
title: "An open Prepare task modal follows the host's next-task prop, so Execute can start a different task than the one prepared"
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
  - "With the modal open for task A, changing the host's taskId to B leaves the modal on A (title, id, prep data and Execute target); a test covers it."
  - "Execute always posts the task id the modal was opened for."
description: "Verdict: must-fix (introduced; wrong task started without warning).\n\nScenario: open Prepare from the Rex Dashboard Up Next card (rex-dashboard.ts:441 polls every 10 s), the Live idle card (live.ts:475), a Workspaces card or the Hench Runs empty state. Before finishing, the next task changes (another worktree claims it, or it completes). StartTaskButton stays mounted with preparing=true and passes the new taskId straight into PrepareTaskModal (components/start-task-button.ts:193-199, no key). The modal refetches prep for task B but keeps A's edits, preview and queued state; while B loads, the header shows A's title next to B's id and Execute is enabled, posting B with options set for A.\n\nReachable: yes, on every polled host. Only the /work/prep route keys the modal (view-registry.ts:139).\n\nFix (recommended): capture the task id at open (`const [prepFor, setPrepFor] = useState<string|null>(null)`) and render `h(PrepareTaskModal, { key: prepFor, taskId: prepFor })`; never re-read the host prop while open. Also reset modal state on taskId change as a second guard."
lastModified: "2026-10-02T07:47:25.440Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
