---
id: "1073b478-bdc0-4f23-9a1c-8aa6eec44bae"
level: "task"
title: "Hub home page: project cards fed from each child's status route, chooser at / when several projects are registered"
status: "completed"
priority: "medium"
tags:
  - "pr-09"
  - "web"
blockedBy:
  - "f7a6d344-fe86-4cff-b003-e1d2e1057330"
source: "parallel-development roadmap, 2026-09-10 discovery session"
startedAt: "2026-09-17T02:49:07.129Z"
completedAt: "2026-09-17T02:57:31.902Z"
endedAt: "2026-09-17T02:57:31.902Z"
resolutionType: "code-change"
resolutionDetail: "Hub root serves a card per project built from GET /api/hub/overview (registry joined onto each child's status and git routes), with a live refresh, the dashboard's theme mechanism, keyboard-reachable controls, and a Start working link into the project's Runs view rather than a second execute route."
acceptanceCriteria:
  - "Screenshot-level check in both themes with two registered projects."
  - "Unit test for the overview aggregation with one healthy and one unreachable child."
description: "packages/web/src/hub/home (small Preact or static entry built by packages/web/build.js like the landing page): GET /api/hub/overview aggregates registry + each child's /api/status (branch, dirty from /api/git/status, hench activeRuns, rex percentComplete, sv analyzedAt). Cards use tokens.css; theme toggle shared with the viewer's theme-toggle component; keyboard accessible. Include a \"Start working\" button per card that navigates to /p/<id>/hench-runs and triggers the existing Start Task button flow there (do not duplicate the execute route)."
lastModified: "2026-09-17T02:57:32.280Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
