---
id: "c816a1a3-5786-4e25-aad2-5a432be1e7de"
type: "task"
title: "Hench classifies why a run failed and ranks the next action"
slug: "hench-classifies-why-a-run-failed-and"
description: "Rule-based classifier over run record, events and review report (hench runs diagnose <id>); verdict banner on the task page. CAOS story: https://www.notion.so/3f7a80b7192481cab29eea95b9d8b8c8."
acceptanceCriteria:
  - "covers eight classes: new test-gate failure, pre-existing test failure, completion held, review blocked, claim lost or refused, budget/timeout/oversized, vendor or transient, no changes"
  - "writes the missing failureReason"
  - "respects the 2-attempt rule"
  - "banner shows without the Sidecar"
priority: "high"
source: "caos"
---
