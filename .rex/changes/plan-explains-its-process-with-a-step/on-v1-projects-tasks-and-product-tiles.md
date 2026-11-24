---
id: "bf824ba4-828e-4d97-b8ec-14ac532365d7"
type: "task"
title: "On v1 projects, Tasks and Product tiles land before Describe a change"
slug: "on-v1-projects-tasks-and-product-tiles"
summary: "On projects still using the older PRD format, the Plan page puts its tiles back in the intended order, with Describe a change first."
description: "Found on integration/plan-analyze-stack: `tilesForLayout` inserts the v1 tiles at the index of the first v2-only tile. With the process band added at index 0, the v1 Tasks and Product tiles now land before the capture tile. `tests/unit/viewer/shell.test.ts` › \"a v1 project shows Tasks and Product tiles…\" fails: expected [\"capture\",\"prd\",\"product\",\"plan-health\"], got [\"prd\",\"product\",\"capture\",\"plan-health\"]."
acceptanceCriteria:
  - "On a v1 project the Plan tile order is capture, prd, product, plan-health"
  - "shell.test.ts passes, including the v1 tile-order test"
  - "The v2 tile order is unchanged"
priority: "medium"
source: "ndx-capture"
---
