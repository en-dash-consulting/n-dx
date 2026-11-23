---
id: "b04e4bec-3324-4e29-b383-9266c8a9c939"
type: "task"
title: "Move Ready to run from Work › Now to the top of Work › Tune"
slug: "move-ready-to-run-from-work-now-to-the"
summary: "The full list of tasks ready to run moves from Work's Now page to the top of its Tune page, keeping your tasks first and the unassigned ones grouped by product area."
description: "In views/stages.ts the `up-next` tile (title Ready to run) moves from the Now mode's tiles to the first tile of the Tune mode, keeping its split (mine, then unassigned by area), filters and estimates. Each card gains an 'Add to queue' action once the queue exists (task 2)."
acceptanceCriteria:
  - "Work › Now no longer shows Ready to run"
  - "Work › Tune shows Ready to run as its first tile, with the mine/unassigned split and filters unchanged"
  - "Layout tests assert both mode tile lists"
priority: "medium"
source: "ndx-capture"
---
