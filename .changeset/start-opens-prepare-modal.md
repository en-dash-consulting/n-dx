---
"@n-dx/web": patch
---

Every Start button opens the Prepare task modal; the PRD panel's separate Execute path is gone.

`StartTaskButton` is now a split button. The primary click opens the Prepare task
modal (a Workspaces card passes its key through, so the modal sends
`X-Ndx-Workspace`); the menu keeps "Start now", the old one-click run with no
options. When the hub queues the run (202), Start now shows the queue position
and reason instead of reporting a start.

The PRD task panel's `ExecuteTaskButton` and its private execute, progress and
Stop code are removed. The panel shows the same split button, or a link to
`/live/task/:taskId` while a run is live (Stop lives in Live). Offering rules are
shared by every surface (`startOffer`): pending and deferred tasks start,
in-progress tasks with no live run show Resume, and blocked tasks list what they
wait on instead of a button. This also fixes the panel's Rules-of-Hooks violation
and gives it the migrate-slugs recovery the other surfaces had.
