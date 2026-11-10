---
id: "d3112cec-53b7-4ce9-b011-209af418fa1b"
type: "task"
title: "Tracker chip shows no state for a change linked by hand that sync never moved"
slug: "tracker-chip-shows-no-state-for-a"
description: "Verdict should-fix (medium). The chip's state comes only from the tracker activity log (packages/web/src/server/tracker/change-chips.ts trackerStateOf): the profile status of the last ok/duplicate sync call for the change. A change linked by hand (Link on its page, or an approved propose_link card) whose work item sync has never created or moved shows the ref and link but no state, so the \"chip with the tracker, item state and a link\" (SP8) is met only for changes sync has acted on. Reachable: GET /api/tracker/changes → Open changes rows and the change detail. Options: (a) read the item's status with the profile's readTool (get_work_item) per linked change, cached and bounded, behind the connection; costs one tracker read per linked change per page load and needs a status-field mapping in the profile; (b) label the chip \"linked · state unknown\" so the gap is explicit; nearly free. Recommend (a) with a short cache, falling back to (b) when the connection is unreachable. Decision (Ryan, 2026-11-05, option D): rows never call the tracker. A chip with no state from the activity log reads \"linked · state unknown\", and a state taken from the log is labelled as the one ndx last set (it can be stale if someone moves the item in the tracker). The change's detail panel does one live read with the profile's readTool when it opens, cached for a short while, and shows the item's current state there. A background refresh of row states in the sync tick (option C) is a separate change, not this task."
acceptanceCriteria:
  - "On Open changes rows, a linked change with no state in the tracker activity log shows its ref and link and reads \"linked · state unknown\"; a state from the log is labelled as set by ndx"
  - "Loading /api/tracker/changes makes no tracker tool call"
  - "Opening the change detail for a linked change makes one read through the profile's readTool and shows the work item's current tracker state; reopening it within the cache window makes no second call"
  - "With the connection unreachable, the detail panel keeps the ref and link and says the state is unknown"
  - "Tests against the fake CAOS server cover the row label, the single detail read and its cache, and the unreachable connection"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
