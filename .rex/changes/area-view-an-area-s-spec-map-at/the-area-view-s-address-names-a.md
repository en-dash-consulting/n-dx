---
id: "aafbcb58-7768-4992-9361-1d7804243c96"
type: "task"
title: "The area view's address names a capability its column does not show"
slug: "the-area-view-s-address-names-a"
description: "Verdict: should-fix, low severity. Found by the adversarial review of d4ea348e.\n\nWhere: packages/web/src/viewer/views/area.ts, AreaView. useInPlaceAddress runs on the raw `selectedId`, but the column renders only when `area.capabilities` lists that id (`selected`).\n\nHow to hit it:\n- Deep link with a display id or alias, e.g. /product/area/<slug>/capability/A1.1. The area lists capabilities by id, so nothing matches.\n- A selected capability is retired, and the area read refreshes.\n\nWhat goes wrong: the column falls back to the four cards, but the address still names the capability. Esc does nothing, because no capability column has focus to receive it. A reload repeats the state.\n\nOptions:\n- (Recommended) Clear `selectedId` when the loaded area does not list it. Alternatively, pass the address hook `selected?.id` once loaded. Either way the address and the column agree. Cost: a few lines and a test.\n- Resolve display ids and aliases in the selection, either by matching `displayId` too or by asking the server. Cost: larger, and only needed if display-id links are wanted."
acceptanceCriteria:
  - "Opening /product/area/<slug>/capability/<unknown> shows the area's cards and leaves the address at /product/area/<slug>"
  - "When the area read stops listing the selected capability, the selection clears and the address returns to the area's"
  - "A test in area-view.test.ts covers both"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
