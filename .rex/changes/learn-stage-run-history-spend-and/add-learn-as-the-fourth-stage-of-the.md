---
id: "03b6cc9a-78c6-4ac2-b034-253781e54e6e"
type: "task"
title: "Add Tune as the fourth stage of the dashboard loop"
slug: "add-learn-as-the-fourth-stage-of-the"
description: "In views/stages.ts: StageId gains \"tune\", STAGE_ORDER becomes analyze, plan, work, tune, and a tune StageDef renders a plain lead section plus tiles (the tile grid Analysis uses). The top navigation shows a Tune tab after Work, and the side stage links wrap from Tune to Analysis. Tune's view-meta entry names it and gives its blurb (\"Fit the ndx workflow to this project and the tools you have.\"). The Sidecar button from #902 stays last in the top nav: add a width step so the extra tab fits (stage hints hide first), per the UX2′ tiers."
acceptanceCriteria:
  - "STAGE_ORDER is analyze, plan, work, tune, and the stage page for tune renders a tile grid"
  - "The top navigation shows Tune after Work, Live stays outside the stage loop, and the Sidecar button stays last"
  - "The side stage link after Tune points to Analysis and the one before Analysis points to Tune"
  - "The top nav does not overflow at 1440, 1200, 1100 or 960 px with the Sidecar button present"
  - "navigation-model tests cover the four-stage loop"
priority: "high"
source: "ndx-capture"
---
