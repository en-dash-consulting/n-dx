---
id: "1444b872-6285-4629-a8dd-d7b92971790f"
level: "task"
title: "Remove the dashboard's Notion and integration routes, flags and setup views"
status: "pending"
priority: "medium"
tags:
  - "pr-03"
  - "lane-rex-surface"
  - "rex"
  - "web"
blockedBy:
  - "6202f721-ef9f-4552-82a7-dc7265831bf9"
source: "roadmap"
acceptanceCriteria:
  - "No /api/notion or integration route is registered"
  - "The feature-toggle list no longer offers rex.notionSync or rex.integrations"
  - "web build and tests pass"
description: "Delete web/src/server/routes-notion.ts and routes-integrations.ts, the rex.notionSync and rex.integrations feature flags in routes-features.ts, the Notion wizard and integration config views, and the rex-gateway re-exports they used."
lastModified: "2026-10-06T04:19:14.564Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
