---
id: "0a4ca999-f630-4aed-8de8-b30dc9701a0c"
level: "task"
title: "Start now on the Live page stays on /live instead of opening the task page it is given navigateTo for"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "web"
  - "live"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A decision is recorded in the item: Start now on /live either navigates to /live/task/<id> or deliberately stays, and the control's props match that decision"
  - "A unit test in packages/web/tests/unit/viewer pins the chosen behaviour for the Live idle card"
description: "Severity: medium. Verdict: out-of-scope (pre-existing), needs a product decision before a fix.\n\nOBSERVED (2026-10-13, manual Playwright flow, real run): on /live the idle card's TaskStartControl (views/live.ts:475, runModes: true, navigateTo passed) — caret → \"Start now\" — POSTs /api/hench/execute successfully, and the page stays on /live showing the run inline under \"Running now\". StartTaskButton's own success path (components/start-task-button.ts:214-216) calls navigateTo(\"live-task\", { taskId }) when navigateTo is provided, and the Hench Runs empty state uses the same control expecting that navigation. Either the Live page intends to stay (then the control's navigateTo should not be passed, and the inline run card is the feedback) or the navigation is being swallowed (then it is a bug).\n\nDecide which; if the navigation is intended, remove the dead expectation and document it; if not, find where the navigation is lost (refresh() racing the navigation in live.ts's onStarted is the first suspect)."
lastModified: "2026-10-13T19:09:37.343Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
