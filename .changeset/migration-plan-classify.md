---
"@n-dx/rex": patch
---

Add `classifyV1Tree`, the first step of the v2 migration plan. It reads a v1 item tree and gives every item one entry with a v2 target, writing nothing. An epic naming a PR or issue becomes one change. An epic naming only a release dissolves into `plannedRelease`, and each of its children becomes a change. A release-named epic never becomes an area. Other epics become areas. Under an area, features become capabilities, constraints or changes from their titles, and each change is placed on a capability or constraint only when the placement rules find a clear leader. Otherwise it is held with `needsPlacement`. The plan also proposes the area list, flagging titles that are not job-shaped and areas with no product node, and the constraints. Not wired to a command yet.
