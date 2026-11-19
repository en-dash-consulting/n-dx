---
id: "42dfda33-2261-4eeb-8402-e737f4c84196"
type: "change"
title: "Short titles: check uniqueness on rename and reopen, and show them everywhere"
slug: "short-titles-check-uniqueness-on"
summary: "Short names for work items are only checked for duplicates when one is set, and several screens still show the long title. This closes those gaps so short names stay unique and appear wherever an item is named."
intent: "Gaps left by change 87627ce2 (optional short titles). (1) Uniqueness among open items is enforced only when a short title is set. Renaming an item's title (when it has no short title, the title is its shown name), or reopening a completed item, can still produce a duplicate shown name among open items. (2) Surfaces that print a raw item title still show the full title: hench run lists, Live views, the Sidecar (including its edit card) and search results. Use the shared row-name helper there, with the full title as tooltip."
acceptanceCriteria:
  - "Changing an item's title is refused when it would duplicate the shown name of another open item"
  - "Reopening a completed item is refused, or asks for a new short title, when its shown name duplicates an open item's"
  - "Hench run lists, Live views, the Sidecar and search results show the short title, with the full title as tooltip"
  - "The Sidecar edit card can set and clear the short title"
  - "Tests cover the rename and reopen checks and each updated surface"
touches:
  - "2171d478-2d5b-4926-8e85-837f52c99abd"
priority: "low"
discoveredFrom: {"item":"87627ce2-d130-493b-9ad7-515cd65fc86a"}
tags:
  - "rex"
  - "web"
source: "ndx-capture"
blockedBy:
  - "87627ce2-d130-493b-9ad7-515cd65fc86a"
---
