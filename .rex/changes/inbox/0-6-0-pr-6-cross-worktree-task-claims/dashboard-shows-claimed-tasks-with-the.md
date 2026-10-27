---
id: "f9e70688-972f-41b8-bd84-54ab99420c0d"
type: "task"
title: "Dashboard shows claimed tasks with the claiming worktree in the PRD tree and the Sessions panel"
slug: "dashboard-shows-claimed-tasks-with-the"
description: "GET /api/rex/claims (new, reads the claims store for the served repo) and a chip on PRD tree rows (\"claimed · <worktree>\", existing .chip style) plus the claimed task title under each worktree in the Sessions panel from PR 5. Refresh on hench:run-changed. Read-only."
acceptanceCriteria:
  - "A task claimed from another worktree shows the chip within one poll interval."
  - "Chip disappears when the claim is released."
priority: "medium"
tags:
  - "pr-06"
  - "web"
source: "parallel-development roadmap, 2026-09-10 discovery session"
blockedBy:
  - "a3e03e31-4abe-4039-a5e8-00cd94c183fd"
  - "69ee731c-5062-4257-8828-7d94f89da8d2"
---
