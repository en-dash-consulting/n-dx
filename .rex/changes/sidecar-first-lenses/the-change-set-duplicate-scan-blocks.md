---
id: "d4f33bf0-b520-43d8-962e-c2269bbf7b39"
type: "task"
title: "The change-set duplicate scan blocks the dashboard server's event loop for ~190 ms per proposed item"
slug: "the-change-set-duplicate-scan-blocks"
description: "Found by the adversarial review of the change-set card task (9637b970). reviewChangeSet (packages/web/src/server/sidecar/change-set.ts) runs findDuplicateItem for each proposed item synchronously against every existing item of its type. On this repo's PRD (2,571 items, 1,155 tasks) that is about 186 ms per proposed task, so a card at the 50-item cap (CHANGE_SET_MAX_ITEMS) blocks the dashboard server's event loop for about 9 s before the card is raised: every route, the websocket and Live stall. Fix with option (a): yield to the event loop between proposed items (await new Promise(setImmediate)), so other requests are served while the scan runs. Total latency stays the same. Do not change the matcher itself: smart add and the card must report the same matches. Tests must not bound a clock reading (tests/e2e/wall-clock-inventory-policy.test.js fails them); prove the yield by ordering instead."
acceptanceCriteria:
  - "reviewChangeSet yields to the event loop between proposed items: a test schedules a setImmediate callback after the review starts and asserts it runs before the review finishes, without reading a clock (tested)"
  - "Duplicate flags are unchanged for the existing sidecar-change-set tests and the rex duplicate-match tests (tested)"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
