---
id: "9aa864df-29bd-4d42-9abd-73e204e922af"
type: "task"
title: "A resumed draft keeps its area when the map read lands last"
slug: "a-resumed-draft-keeps-its-area-when"
description: "Stack review round 2 finding on #987 at packages/web/src/viewer/views/placement-mode.ts:332 (review comment 4494325257).\n\n**Should fix: a resumed proposal draft's area loses to the opening zoom when the map read lands last**\n\nThis ghost-follow effect and the opening-zoom effect (lines 368–372) can both call `setZoom` in the same commit. If the draft's ghost and the shortlist are already set when `/api/rex/product` resolves, `ghostArea` and `map` change together. This effect sets the draft's area. The opening effect then runs with `zoom` still `undefined` in its closure and overwrites it with the shortlist's area. This effect never fires again, because `ghostArea?.slug` didn't change. The form keeps its saved area, but the map, breadcrumb and `proposeUnder` show the shortlist's area, and no ghost is drawn. The \"resumes a proposal under its saved area\" test passes only because the stub delivers the map first.\n\nFix: start the opening zoom at `ghostArea.slug` when there is one, or declare this effect after the opening one. Add a test that delays `/api/rex/product` until after `/placements`. S8 has the same effect order."
acceptanceCriteria:
  - "In placement-mode.ts a resumed proposal draft keeps its area: the opening zoom starts at ghostArea.slug when there is one, or the ghost-follow effect runs last"
  - "A test delays /api/rex/product until after /placements and asserts the draft's area is kept"
---
