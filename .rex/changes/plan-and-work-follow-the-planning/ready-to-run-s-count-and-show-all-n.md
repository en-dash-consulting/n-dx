---
id: "55e42662-38a1-4ccb-9b39-ee64245f8cc5"
type: "task"
title: "Ready to run's count and 'Show all N' ignore the mine/unassigned split"
slug: "ready-to-run-s-count-and-show-all-n"
summary: "Work's Ready to run shows a count and a 'Show all' number that include tasks it never lists, so the numbers do not match what is on screen."
description: "Failure: components/ready-to-run.ts builds the controls' '{shown} of {total}' from the unsplit list and the 'Show all {total}' button from the server total. In split mode the list shows up to three rows per group plus every area group, and never lists tasks assigned to someone else, so the counter reads e.g. '3 of 40' while more rows are visible and 'Show all 40' cannot show 40. Reachability: Work › Now with more than three ready tasks. Verdict: should-fix (low), introduced by efcc0da8e. Fix: in split mode, count and label only the mine and unassigned rows (and say how many are hidden as someone else's, as the list already does)."
acceptanceCriteria:
  - "In split mode the counter equals the rows the list can show (mine + unassigned), not the server total (unit test)"
  - "'Show all N' names the mine + unassigned count in split mode"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
