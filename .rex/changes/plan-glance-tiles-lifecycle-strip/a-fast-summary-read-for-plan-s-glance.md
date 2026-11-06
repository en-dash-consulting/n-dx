---
id: "231adb0e-64e8-401c-91ed-c6ca8e30f5ad"
type: "task"
title: "A fast summary read for Plan's glance tiles"
slug: "a-fast-summary-read-for-plan-s-glance"
description: "GET /api/rex/changes did not answer within 30 seconds on this repository (1,390 changes) on 2026-10-28. Measure where the time goes first, then give Plan a summary read: counts by change stage (ChangeStageWire) and Inbox, the placed open changes with the fields the glance shows, and the next pick with its reason. Either a new summary route under routes-rex or a cache on the full route invalidated by rex:prd-changed; choose from the measurement and record the numbers in the task log."
acceptanceCriteria:
  - "The time spent in GET /api/rex/changes on this repository is measured and recorded in the task log, before and after"
  - "Plan's glance read answers in under two seconds on this repository's PRD"
  - "The read refreshes after rex:prd-changed"
  - "A route test covers the summary shape on the v2 fixture"
priority: "high"
source: "ndx-capture"
---
