---
id: "161cbeed-8c8c-4411-bf4d-5c9400d08a36"
type: "task"
title: "Leaving a capability keeps the hub prefix in the address"
slug: "leaving-a-capability-keeps-the-hub"
description: "Stack review finding on #980 at packages/web/src/viewer/views/area.ts:79 (review comment 4488638346).\n\n**Must fix: deselecting a capability drops the hub's `/p/<id>` prefix from the address**\n\n`AreaView` passes `restoreTo = areaPath(slug)`, a root-relative `/product/area/<slug>` (line 149). The cleanup writes it with a direct `history.replaceState(stateBefore, \"\", locationBefore)` that never goes through `appUrl()`. Behind the hub (`/p/<id>/…`) or on a worktree (`/w/<key>/…`), selecting a block and then pressing Esc or \"Area\" moves the address to `/product/area/<slug>` without the prefix. The next reload lands on the hub root, which answers 409 once more than one project is registered: the failure `history-guard.test.ts` exists to prevent. The guard passes only because its regex matches \"location\" in `locationBefore`.\n\nFix: when `restoreTo` is set, restore with `replaceAppHistory(stateBefore, restoreTo)`, or pass `restoreTo` through `appUrl()`. Add an area-view test under `setBasePathForTests(\"/p/x\")`.\n\nMUST FIX for #980."
acceptanceCriteria:
  - "AreaView restores restoreTo through replaceAppHistory or appUrl, never a bare history.replaceState, so the hub's /p/<id> prefix survives deselecting a capability"
  - "An area-view test under setBasePathForTests(\"/p/x\") selects and deselects a capability and asserts the address keeps /p/x"
---
