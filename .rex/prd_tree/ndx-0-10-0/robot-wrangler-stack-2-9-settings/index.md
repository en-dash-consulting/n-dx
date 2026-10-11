---
id: "f8121e9f-277e-4d6a-bbc2-68e9e2f62def"
level: "feature"
title: "Robot Wrangler stack 2/9 · Settings fixes the redesign stands on"
status: "completed"
priority: "high"
tags:
  - "0.10.0"
  - "robot-wrangler-redesign"
  - "rw-stack-2"
source: "claude-code: Robot Wrangler redesign session 2026-10-10 (PR stack)"
startedAt: "2026-10-11T00:04:50.361Z"
completedAt: "2026-10-11T00:33:17.529Z"
endedAt: "2026-10-11T00:33:17.529Z"
acceptanceCriteria:
  - "No viewer stylesheet uses an undefined custom property without a fallback, and a test enforces it."
  - "Every settings page renders while the analysis data is still loading."
  - "Partly fixes #660 (items 1 and 3)."
description: "Two defects from #660 that every later Robot Wrangler change depends on. `robot-wrangler.css` references 19 custom properties that no stylesheet defines, so most of the page's colours and spacing fall back to nothing (the Automatic failover toggle renders as a lone white dot, and the header tile touches the title). Separately, the settings overlay renders nothing until the app's sourcevision data has loaded, although no settings page uses that data, so on a busy checkout a settings page can stay blank for 40+ seconds.\n\nThis is PR 2 of the 9-PR Robot Wrangler stack. It changes no layout: it makes the existing page render on real design tokens and makes settings pages independent of the analysis-data load.\n\nGoal: Settings pages render immediately and on the real design tokens."
lastModified: "2026-10-11T00:33:17.800Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Prove with a test that settings pages render while the analysis data is still loading](./prove-with-a-test-that-settings-pages.md) | completed |
| [Rebuild robot-wrangler.css on the defined design tokens and fail tests on undefined custom properties](./rebuild-robot-wrangler-css-on-the.md) | completed |
| [Render the settings overlay's page without waiting for the analysis-data load](./render-the-settings-overlay-s-page.md) | completed |
