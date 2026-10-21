---
id: "b8e2793b-26db-4f33-8d01-f41404d5502f"
level: "task"
title: "Hub project cards show readiness and infrastructure counts"
status: "pending"
priority: "medium"
source: "ndx-capture"
acceptanceCriteria:
  - "ChildSnapshot and ProjectCard carry sv.readiness.overall and sv.infrastructure from the child's /api/status"
  - "The hub card renders both when present and omits them when the child is an older build that does not answer them"
  - "Hub overview tests cover the present and absent cases"
description: "#599 added sv.readiness and sv.infrastructure to GET /api/status for the hub cards, but ChildSnapshot and ProjectCard in packages/web/src/hub/overview.ts only carry repoName and remoteHost, so the counts never reach the card."
lastModified: "2026-10-21T04:17:25.090Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
