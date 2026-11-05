---
id: "d3112cec-53b7-4ce9-b011-209af418fa1b"
type: "task"
title: "Tracker chip shows no state for a change linked by hand that sync never moved"
slug: "tracker-chip-shows-no-state-for-a"
description: "Verdict should-fix (medium). The chip's state comes only from the tracker activity log (packages/web/src/server/tracker/change-chips.ts trackerStateOf): the profile status of the last ok/duplicate sync call for the change. A change linked by hand (Link on its page, or an approved propose_link card) whose work item sync has never created or moved shows the ref and link but no state, so the \"chip with the tracker, item state and a link\" (SP8) is met only for changes sync has acted on. Reachable: GET /api/tracker/changes → Open changes rows and the change detail. Options: (a) read the item's status with the profile's readTool (get_work_item) per linked change, cached and bounded, behind the connection; costs one tracker read per linked change per page load and needs a status-field mapping in the profile; (b) label the chip \"linked · state unknown\" so the gap is explicit; nearly free. Recommend (a) with a short cache, falling back to (b) when the connection is unreachable."
acceptanceCriteria:
  - "A change linked to WM-1 with no sync activity shows the work item's current tracker state on its chip, read through the profile's read tool"
  - "With the connection unreachable the chip still shows the ref and says the state is unknown"
  - "A test against the fake CAOS server covers both cases"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
