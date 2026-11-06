---
id: "04541a56-4cb7-4fdc-a716-3446f32a321e"
type: "task"
title: "Docs say which panels read the summary route"
slug: "docs-say-which-panels-read-the-summary"
description: "Stack review finding on #963 at docs/packages/web.md:8 (review comment 4488637225).\n\n**Should fix: docs and changeset say all three panels read the summary route**\n\nHere and in `.changeset/plan-glance-tiles-docs.md`, all three panels are said to read `GET /api/rex/changes/summary`. Only the strip and the glance do; `ProductAreaMap` calls `useProductRead(\"/api/rex/product\", …)`, the full map read. Reword both texts. The sentence is unchanged at the S8 tip."
acceptanceCriteria:
  - "docs/packages/web.md says the strip and the glance read /api/rex/changes/summary and the area map reads /api/rex/product"
  - ".changeset/plan-glance-tiles-docs.md says the same"
---
