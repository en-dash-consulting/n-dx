---
id: "cae4146e-0330-4936-baa3-231ace031c09"
type: "task"
title: "The server code that names a work card's and a run plan's change has no test"
slug: "the-server-code-that-names-a-work-card"
description: "Verdict: should-fix (adversarial review of c76674c4, run 5ab728db). Two server functions build the change wording the Sidecar shows, and neither has a test: `describeRunnable` (packages/web/src/server/routes-hench.ts) for the work card's `rowText`, and the `withPlannedRowText` call inside `readQueuePlan` (same file) for the run-plan card's track rows and Live's Ready next. The viewer tests in runnable-rows.test.ts give the viewer `rowText` directly, and withPlannedRowText's unit test calls it directly, so removing either server call leaves every test green while the work card and track rows fall back to bare titles. Reachable: start_work from a Sidecar session (broker-mcp.ts sets annex.rowText) and GET /api/hench/plan-queue. Fix: a unit test that builds a ServerContext on a v2 fixture `.rex/.cache/prd.json` and checks describeRunnable for (a) a task under a change, (b) a task-less change, and (c) an unknown id; and a test that readQueuePlan (with a stubbed exec, or through the Sidecar actions' readRunPlan) returns tasks carrying rowText. Cost: one test file, no production change."
acceptanceCriteria:
  - "describeRunnable returns \"<task> · in <change>\" for a task under a v2 change, \"<change> · runs as one task\" for a task-less change, and null for an unknown id (server unit test)"
  - "A test fails if readQueuePlan stops applying withPlannedRowText to the planner's JSON"
  - "A broker test shows a start_work card carrying rowText when the actions provide describeWork"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
