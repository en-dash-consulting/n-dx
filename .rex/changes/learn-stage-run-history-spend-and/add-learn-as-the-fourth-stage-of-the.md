---
id: "03b6cc9a-78c6-4ac2-b034-253781e54e6e"
type: "task"
title: "Add Learn as the fourth stage of the dashboard loop"
slug: "add-learn-as-the-fourth-stage-of-the"
description: "In views/stages.ts: StageId gains \"learn\", STAGE_ORDER becomes analyze, plan, work, learn, and a learn StageDef renders a plain lead section plus tiles (the tile grid Analysis uses). The top navigation shows a Learn tab after Work, and the side stage links wrap from Learn to Analysis. Learn's view-meta entry names it and gives its blurb (\"What the runs did, what they cost, and what to change.\")."
acceptanceCriteria:
  - "STAGE_ORDER is analyze, plan, work, learn, and the stage page for learn renders a tile grid"
  - "The top navigation shows Learn after Work, and Live stays outside the stage loop"
  - "The side stage link after Learn points to Analysis and the one before Analysis points to Learn"
  - "navigation-model tests cover the four-stage loop"
priority: "high"
source: "ndx-capture"
---
