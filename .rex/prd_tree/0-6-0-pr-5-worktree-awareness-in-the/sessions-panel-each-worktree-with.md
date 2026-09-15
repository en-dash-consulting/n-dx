---
id: "69ee731c-5062-4257-8828-7d94f89da8d2"
level: "task"
title: "Sessions panel: each worktree with branch, dirty state, and running or last run"
status: "pending"
priority: "medium"
tags:
  - "pr-05"
  - "web"
blockedBy:
  - "271a28ee-10dc-41d3-9e35-5f10571cbcfe"
source: "parallel-development roadmap, 2026-09-10 discovery session"
acceptanceCriteria:
  - "Pill and expanded panel render for a repo with several worktrees in both themes; keyboard accessible like the other trays."
  - "Panel is hidden when the served directory is not a git repo or has a single worktree."
description: "Add a Sessions panel to the viewer, placed with the existing bottom-right trays (git-status-banner.ts, active-operations-tray.ts) as a third pill \"N worktrees · M running\" that expands into a list: worktree name (anchor starred), branch (mono), dirty count (orange) or clean, running run title with elapsed time or last finished run and its status, and a link to that run in the Runs view. Data from /api/worktrees polled on the existing use-polling cadence and refreshed on hench:run-changed. This is read-only and does not switch the dashboard's workspace; the 0.8.0 release turns it into the Workspaces Overview."
lastModified: "2026-09-10T20:12:01.045Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
