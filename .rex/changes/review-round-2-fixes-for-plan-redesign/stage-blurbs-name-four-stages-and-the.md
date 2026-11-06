---
id: "653ddf07-b10d-415a-a861-e5b1c129a21d"
type: "task"
title: "Stage blurbs name four stages and the right homes"
slug: "stage-blurbs-name-four-stages-and-the"
description: "Stack review round 2 finding on #961 at packages/web/src/viewer/views/view-meta.ts:107 (review comment 4494323240).\n\n**Should fix: Plan, Work and Home blurbs still advertise what moved to Tune and Settings**\n\nThe Work blurb still says \"…pick a run mode, watch what it costs\", and the Plan blurb (line 101) still ends \"…and the planning commands\". This PR moves Spend to Tune and All Commands to Settings › Commands. Both blurbs show on the Home stage cards and on each stage page heading, so users are sent to the wrong stage. The `home` blurb (line 65, \"The three stages of the loop\") and the `stages.ts` header (\"Three stages in a loop\") are stale too. S8 still has all of them."
acceptanceCriteria:
  - "view-meta.ts's Plan blurb no longer offers 'the planning commands' and the Work blurb no longer offers 'watch what it costs'"
  - "The home blurb and the stages.ts header say four stages"
  - "A test reads the stage blurbs (or the tests that show them are updated) so they cannot drift back"
---
