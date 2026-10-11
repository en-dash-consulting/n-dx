---
id: "b9a59e46-7881-48ab-be02-ff59fdb60b68"
level: "task"
title: "Render the settings overlay's page without waiting for the analysis-data load"
status: "completed"
priority: "high"
tags:
  - "0.10.0"
  - "robot-wrangler-redesign"
  - "rw-stack-2"
source: "claude-code: Robot Wrangler redesign session 2026-10-10 (PR stack)"
startedAt: "2026-10-10T23:49:46.578Z"
completedAt: "2026-10-11T00:04:48.837Z"
endedAt: "2026-10-11T00:04:48.837Z"
acceptanceCriteria:
  - "With useAppData still loading, opening /robot-wrangler, /project, /workflow or /commands renders that page's content (unit test with loading forced true)."
  - "Analysis views still show the loading state until their data arrives."
  - "No settings view throws when the analysis data is empty."
  - "`pnpm --filter @n-dx/web test` and the package typecheck pass."
description: "`packages/web/src/viewer/main.ts` renders the settings overlay's content as `loading ? null : renderActiveView(view, viewCtx)`, where `loading` is `useAppData`'s flag for the sourcevision data modules. Robot Wrangler, Project, Workflow and Commands use none of that data, but all of them wait for it; on a repository with many worktrees the Commands page stayed blank for 40+ seconds.\n\nRender the active settings view as soon as the overlay opens, whatever `loading` says. Keep the loading gate for analysis views. If a settings view needs `data`, it must handle `data` being empty rather than relying on the gate (check each of the four)."
lastModified: "2026-10-11T00:04:49.196Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
