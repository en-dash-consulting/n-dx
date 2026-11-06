---
id: "2fc2b2e0-e31f-43a8-8978-885afd888c4b"
type: "task"
title: "Placement mode says \"rex found no candidate\" when the shortlist read failed"
slug: "placement-mode-says-rex-found-no"
description: "Scenario: GET /api/rex/changes/placements fails (HTTP 500, network error, or a per-change { error }). useInbox stores { error } as the row's shortlist, so PlacementMode sees placement === null. It opens the area level, and mapLevelNote(null) prints \"rex found no candidate. Pick an area, or search in the panel.\" The panel beside it shows \"No shortlist: <error>\" as an alert, so the two messages contradict each other and the map's note misstates the cause.\n\nEvidence: packages/web/src/viewer/views/placement-mode.ts. mapLevelNote handles null as \"no candidate\", and PlacementMode passes `placement`, which is null for an error read as well as for no read. Reachable from any Place entry point while the placements route fails.\n\nVerdict: should-fix, low. The panel's alert names the real cause, so nobody acts on a wrong answer, but the map note is wrong.\n\nFix (recommended): pass the read to the note, and on an error read say \"Could not read rex's shortlist: <error>. Pick an area, or search in the panel.\" It costs a couple of lines and a test, with no risk."
acceptanceCriteria:
  - "When the change's shortlist read fails, placement mode's area-level note names the failure instead of saying rex found no candidate"
  - "A unit test serving a failed /api/rex/changes/placements asserts the area-level note carries the error text"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "web"
  - "placement"
source: "ndx-adversarial-review"
---
