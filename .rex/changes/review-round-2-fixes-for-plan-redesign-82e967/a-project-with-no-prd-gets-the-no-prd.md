---
id: "e916a9c8-a829-4b94-99f0-622c35071682"
type: "task"
title: "A project with no PRD gets the no-PRD empty state, not v2 tiles"
slug: "a-project-with-no-prd-gets-the-no-prd"
description: "Stack review round 2 finding on #962 at packages/web/src/viewer/views/stage-pages.ts:263 (review comment 4494323602).\n\n**Should fix: a project with no PRD gets v2 tiles that tell it to run `ndx migrate`**\n\n`known.current = status.rex?.layout ?? \"v2\"` treats a status with no `layout` as v2. The server sends no layout when `rex.exists` is false (routes-status.ts:556). On such a project `prdLayout` finds no `product/`, so `/api/rex/product` and `/api/rex/changes` answer `{ layout: \"v1\" }`. The full-width Product tile and the Open changes preview then both render `NoProductLayer` (\"…uses the v1 layout… Run `ndx migrate`\"), though there is nothing to migrate. Plan also loses the Tasks tile's \"no PRD yet\" empty state that the old open `prd` section gave. On base, Product and Changes were collapsed sections that never mounted. The test \"shows the v2 tiles when status arrives with no PRD\" pins the current behaviour, and S8 is unchanged.\n\nFix: treat `rex.exists === false` as its own state and draw `v1Tiles` (the Tasks empty state), or have the v2 views tell \"no PRD\" apart from v1. Then update that test."
acceptanceCriteria:
  - "LayoutTileGrid treats rex.exists === false as its own state and draws v1Tiles (the Tasks tile's 'no PRD yet' empty state), not the v2 tiles that say to run ndx migrate"
  - "The test 'shows the v2 tiles when status arrives with no PRD' and the round-1 tests it pins are updated to the no-PRD state"
---
