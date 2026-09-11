---
id: "9cb2fa5b-a788-4193-b6e7-e08e53221124"
level: "task"
title: "Dashboard footer shows server version, install path and served project directory"
status: "pending"
priority: "medium"
tags:
  - "pr-07"
  - "web"
blockedBy:
  - "b41d7f6b-5e05-4f53-a4c6-594dc39f5303"
source: "parallel-development roadmap, 2026-09-10 discovery session"
acceptanceCriteria:
  - "Footer shows version, install path and project dir on every view in both themes."
  - "Unit test for the footer rendering with and without the server object (older servers)."
description: "packages/web/src/viewer/components/config-footer.ts already renders configuration summary from /api/ndx-config. Add a compact identity line fed by the server object added in PR 1 (GET /api/config server.*): \"n-dx <version> · <cliPath shortened to the checkout root> · <projectDir basename>\", with the full paths in a title tooltip. Visible on every view; theme-aware via existing tokens; no new fetch if /api/config is already loaded at boot (packages/web/src/viewer/main.ts fetches it, thread the value through)."
lastModified: "2026-09-10T20:11:53.540Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
