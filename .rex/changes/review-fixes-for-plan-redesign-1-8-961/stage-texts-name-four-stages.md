---
id: "df7e2b70-9d15-4ad9-bf60-5259db2b72ad"
type: "task"
title: "Stage texts name four stages"
slug: "stage-texts-name-four-stages"
description: "Stack review finding on #961 at packages/web/src/viewer/components/top-nav.ts:17 (review comment 4488636480).\n\n**Should fix: stale stage text after the move to four stages**\n\n\"`/hench-runs/<id>` keeps Plan lit\" is now wrong: `hench-runs` is a Tune tile and lights Tune, which `restored-views.test.ts` asserts with `stageForView(view)).toBe(\"tune\")`. Two other texts are stale in the same way. The `TopNav` row in `docs/architecture/viewer-architecture.md` (line 86, a file this PR edits) still says \"the three stage tabs\". The `commands-sheet.ts` header still says the reference has its own page at `/command-reference`, which now redirects to `/commands/reference`."
acceptanceCriteria:
  - "top-nav.ts says /hench-runs/<id> lights Tune, not Plan"
  - "The TopNav row in docs/architecture/viewer-architecture.md names the four stage tabs"
  - "The commands-sheet.ts header says /command-reference redirects to /commands/reference (Settings › Commands › Reference)"
---
