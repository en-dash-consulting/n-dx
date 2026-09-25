---
id: "f9e70688-972f-41b8-bd84-54ab99420c0d"
level: "feature"
title: "Dashboard shows claimed tasks with the claiming worktree in the PRD tree and the Sessions panel"
status: "completed"
priority: "medium"
tags:
  - "pr-06"
  - "web"
blockedBy:
  - "a3e03e31-4abe-4039-a5e8-00cd94c183fd"
  - "69ee731c-5062-4257-8828-7d94f89da8d2"
source: "parallel-development roadmap, 2026-09-10 discovery session"
startedAt: "2026-09-17T00:29:59.938Z"
completedAt: "2026-09-17T00:36:26.945Z"
endedAt: "2026-09-17T00:36:26.945Z"
resolutionType: "code-change"
resolutionDetail: "GET /api/rex/claims + useClaims hook; \"claimed · <worktree>\" tag-chip on PRD tree rows and per-worktree claimed-task lines in the Sessions tray, refreshed on poll and hench:run-changed."
acceptanceCriteria:
  - "A task claimed from another worktree shows the chip within one poll interval."
  - "Chip disappears when the claim is released."
description: "GET /api/rex/claims (new, reads the claims store for the served repo) and a chip on PRD tree rows (\"claimed · <worktree>\", existing .chip style) plus the claimed task title under each worktree in the Sessions panel from PR 5. Refresh on hench:run-changed. Read-only."
lastModified: "2026-09-17T00:36:27.318Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
