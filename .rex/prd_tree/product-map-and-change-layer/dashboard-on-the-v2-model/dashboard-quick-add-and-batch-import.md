---
id: "812b0599-8d2a-41f9-9570-3060ce5d3a78"
level: "task"
title: "Dashboard Quick Add and batch import show an empty preview on a v2 tree"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "web"
  - "lane-web"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "On a v2 tree, Quick Add's preview lists each change rex add would create, with its suggested placement, instead of an empty proposal list"
  - "Accepting a v2 Quick Add preview creates the changes in the Inbox (needsPlacement) and nothing on the v1 tree"
  - "A web integration test covers the v2 Quick Add preview and accept against the v2 fixture"
description: "Scenario: on a v2 PRD (product/ and changes/), the dashboard's Quick Add (routes-rex-analysis.ts:971, `rex add --format=json --fast --description …`) and batch import without accept (routes-rex-analysis.ts:1097) spawn rex add in preview mode. Since PR 18 (task 08b9e858), rex add on a v2 tree previews one change per description and prints `{ preview: true, changes: [...], proposals: [], qualityIssues: [] }`, writing nothing. The web reads only `proposals`, so the user sees an empty preview and cannot add a change from the dashboard; the v1 accept path (which writes epics/features/tasks) has no v2 counterpart.\n\nReachable: any dashboard user on a v2 tree, via Quick Add or batch import.\n\nVerdict: out-of-scope for PR 18 (web lane; PR 18's boundary forbids web changes). Before PR 18 the v2 path ran v1 smart-add against a v2 tree, so the dashboard never supported v2 adds.\n\nOptions: (1) recommended — web reads `changes` when `preview` is true, renders each change with its placement shortlist, and on accept spawns `rex add --accept` (or add_item) to create the changes; (2) web refuses Quick Add on a v2 tree with a message pointing at `ndx add` — cheaper, but leaves a gap in the dashboard."
lastModified: "2026-10-09T07:10:47.731Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
