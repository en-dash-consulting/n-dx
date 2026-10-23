---
id: "8fd96b07-8037-4722-a80d-88269f148e90"
type: "change"
title: "Build completion timeline data source from PRD items"
slug: "build-completion-timeline-data-source"
intent: "Create a utility that walks the PRD tree, collects all items with a completedAt timestamp, and returns them sorted by completion date (most recent first). Include item title, level, parent chain breadcrumb, and completion timestamp. This feeds the timeline view."
acceptanceCriteria:
  - "Returns completed items sorted by completedAt descending"
  - "Each entry includes title, level, parent chain, and timestamp"
  - "Handles items without completedAt gracefully (excluded)"
  - "Unit tested"
touches:
  - "577c74cb-da15-4cb2-aca7-3012fe840896"
priority: "medium"
tags:
  - "web"
  - "rex"
---
