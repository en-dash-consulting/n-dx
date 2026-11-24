---
id: "059f9fbe-4b29-4c29-8597-c701c30bc994"
type: "task"
title: "How work moves shows \"…\" forever when its reads fail"
slug: "how-work-moves-shows-forever-when-its"
summary: "When Plan could not read its counts, How work moves kept showing placeholders with no explanation; it now says it could not load them."
description: "Failure: plan-flow.ts:44 computes counts only when both the change summary and the change list are ready, so an error leaves every count as \"…\" with no message. Reachable: a failing /api/rex/changes/summary or /api/rex/changes. Verdict: should-fix (cheap). Fix: a line under the strip naming the failure; the stages still focus the page."
acceptanceCriteria:
  - "A failed summary or change-list read shows a message under How work moves"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
