---
id: "1444b872-6285-4629-a8dd-d7b92971790f"
level: "task"
title: "Remove the dashboard's Notion and integration routes, flags and setup views"
status: "completed"
priority: "medium"
tags:
  - "pr-03"
  - "lane-rex-surface"
  - "rex"
  - "web"
blockedBy:
  - "6202f721-ef9f-4552-82a7-dc7265831bf9"
source: "roadmap"
startedAt: "2026-10-06T06:52:43.894Z"
completedAt: "2026-10-06T07:18:18.540Z"
endedAt: "2026-10-06T07:18:18.540Z"
resolutionType: "code-change"
resolutionDetail: "Deleted routes-notion.ts and its /api/notion/* endpoints, the notion-config and integration-config views, the Notion schema wizard and both stylesheets; removed the rex.notionSync and rex.integrations toggles from the feature registry, the route gate table, the static export's features.json and ndx config --help. Also removed the now-dead RouteFeatureGate.prefix branch and the orphaned .cmd-sync-*/.intg-* CSS. Build, typecheck, 158 root test files, all 5 package suites, obfuscation scan and pr-check all pass."
acceptanceCriteria:
  - "No /api/notion or integration route is registered"
  - "The feature-toggle list no longer offers rex.notionSync or rex.integrations"
  - "web build and tests pass"
description: "Delete web/src/server/routes-notion.ts and routes-integrations.ts, the rex.notionSync and rex.integrations feature flags in routes-features.ts, the Notion wizard and integration config views, and the rex-gateway re-exports they used."
lastModified: "2026-10-06T07:18:20.814Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
