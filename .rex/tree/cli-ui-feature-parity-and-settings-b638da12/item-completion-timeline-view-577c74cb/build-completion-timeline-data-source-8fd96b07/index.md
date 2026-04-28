---
id: "8fd96b07-8037-4722-a80d-88269f148e90"
level: "task"
title: "Build completion timeline data source from PRD items"
status: "completed"
priority: "medium"
tags:
  - "web"
  - "rex"
startedAt: "2026-03-24T20:12:13.057Z"
completedAt: "2026-03-24T20:36:01.337Z"
acceptanceCriteria:
  - "Returns completed items sorted by completedAt descending"
  - "Each entry includes title, level, parent chain, and timestamp"
  - "Handles items without completedAt gracefully (excluded)"
  - "Unit tested"
description: "Create a utility that walks the PRD tree, collects all items with a completedAt timestamp, and returns them sorted by completion date (most recent first). Include item title, level, parent chain breadcrumb, and completion timestamp. This feeds the timeline view."
---
