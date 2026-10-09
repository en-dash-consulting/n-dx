---
id: "2898acbe-09f4-4c01-a791-0eb500c11491"
level: "task"
title: "Write Inbox changes to the reserved changes/inbox/ folder, and move them out on placement"
status: "pending"
priority: "high"
tags:
  - "rex"
  - "lane-rex-store"
  - "before-0.9.0"
  - "product-map"
source: "decision"
acceptanceCriteria:
  - "add_item on a v2 tree writes an unplaced change (no amends, no touches) to changes/inbox/<slug>/index.md, with needsPlacement: true in that folder's state.yaml (test)"
  - "The v2 reader treats changes/inbox/ as a reserved folder, not a change: its children are top-level changes in the Inbox (test)"
  - "place_change with a target moves the change out of changes/inbox/ to the changes root, or under its area if the layout calls for one, clears needsPlacement, and keeps the change's id and slug (test)"
  - "get_prd_status's Inbox count and get_capability's change lists are unchanged by the move (test)"
  - "A v2 tree written by #612, with Inbox changes at the changes root, still reads; the next write through the transaction moves them into changes/inbox/ (test)"
  - "The bundle export/import (PR 15) round-trips a tree with an Inbox folder (test)"
description: "Decided 2026-10-07 (Sterling H, recorded on fdddee24 via #606) and confirmed 2026-10-09 (Ryan): the Inbox is a reserved folder, not a view. An unplaced change lives at `changes/inbox/<slug>/index.md` with `needsPlacement: true` in that folder's `state.yaml`, and placement later moves it out. The rejected alternative was \"Inbox = anything with needsPlacement, written at the changes root\".\n\nPR 17 (#612) shipped that rejected alternative, because the 10-07 note was on a branch until #606 merged. Ryan chose to merge the #610/#612 stack as is and land this before 0.9.0, which freezes the v2 layout. No v2 trees exist outside fixtures yet, so nothing needs migrating beyond the read-tolerance criterion.\n\nLane: store (prd-model-reader.ts, prd-model-writer.ts, folder layout constants) plus core/change-add.ts and core/change-place.ts, and tests. Coordinate with Sterling (the decision's author) and with PR 15's bundle format."
lastModified: "2026-10-09T16:37:03.775Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
