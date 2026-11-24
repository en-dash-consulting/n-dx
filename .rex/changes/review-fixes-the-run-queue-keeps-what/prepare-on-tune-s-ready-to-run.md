---
id: "21360996-d2b1-447e-8d07-34e9786c76a0"
type: "task"
title: "Prepare… on Tune's Ready to run switches the page to Now"
slug: "prepare-on-tune-s-ready-to-run"
summary: "Pressing Prepare on a ready task in Work › Tune jumped the page to Work › Now; it now opens over Tune and closes back to it."
description: "Failure: work-now.ts:172 navigates to (\"work\", {taskId}) — /work/prep/<id> — and the Prepare modal is drawn only by the \"work\" registry entry (view-registry.ts:258), so Tune's primary button leaves Tune. Reachable: every card on Work › Tune. Verdict: must-fix. Fix: a /tune/prep/<id> route (route-state parse/build, isTaskRouteView) and the modal on the \"tune\" entry closing back to /tune; Ready to run on Tune prepares there."
acceptanceCriteria:
  - "/tune/prep/<id> parses to Tune with that task and builds back to the same path"
  - "Prepare… on Tune opens the modal over Tune, and closing it returns to /tune"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
