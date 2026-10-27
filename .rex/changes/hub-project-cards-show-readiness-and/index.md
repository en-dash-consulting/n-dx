---
id: "b8e2793b-26db-4f33-8d01-f41404d5502f"
type: "change"
title: "Hub project cards show readiness and infrastructure counts"
slug: "hub-project-cards-show-readiness-and"
intent: "#599 added sv.readiness and sv.infrastructure to GET /api/status for the hub cards, but ChildSnapshot and ProjectCard in packages/web/src/hub/overview.ts only carry repoName and remoteHost, so the counts never reach the card."
acceptanceCriteria:
  - "ChildSnapshot and ProjectCard carry sv.readiness.overall and sv.infrastructure from the child's /api/status"
  - "The hub card renders both when present and omits them when the child is an older build that does not answer them"
  - "Hub overview tests cover the present and absent cases"
touches:
  - "26a42aed-6a93-471f-9ab4-259b97877d68"
priority: "medium"
source: "ndx-capture"
---
