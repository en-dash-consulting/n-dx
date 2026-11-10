---
id: "8722270b-60ea-428e-904e-deb8ded883d8"
type: "task"
title: "Ghost markers on the area view's spec-map blocks"
slug: "ghost-markers-on-the-area-view-s-spec"
description: "Hub decision (2026-11-05), from 05eba8de's criterion 'A waiting change-set card's items show as dashed rows in Open changes and as dashed markers on the blocks they target'. Plan's product area map already draws +N dashed .pam-ghost markers (product-area-map.ts: AreaBlockModel.ghosts, areaGhosts). S6's area view draws capability blocks through the same AreaBlock component (area-spec-map.ts), but never sets ghosts, so a waiting card's items that target a capability show no marker there. Count the waiting card items per capability (and constraint band, if one is targeted) the way areaGhosts does per area, pass ghosts to each capability block, and keep the block's accessible name saying how many are waiting. Deny removes the markers; approval replaces them with real open-change markers."
acceptanceCriteria:
  - "With a waiting change-set card whose items target capabilities in an area, the area view's spec map shows a dashed +N marker on each targeted block, and its accessible name says N waiting on a card"
  - "Deny removes the markers and approval replaces them with the blocks' real open-change markers"
  - "A unit test covers the area view's ghost counts per capability"
priority: "medium"
---
