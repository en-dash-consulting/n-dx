---
id: "678d4043-449f-43ab-a5c7-20ea90d2acc9"
level: "task"
title: "Migration plan flags incident narratives as stale descriptions"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "pr-13"
  - "lane-migration"
  - "rex"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A completed item whose description is an adversarial-review finding (\"**Severity:** medium — **Verdict:** should-fix … FAILURE SCENARIO …\") is not flagged stale-description (unit test)"
  - "A completed item whose description opens with \"TODO:\" or a work verb describing unbuilt intent is still flagged stale-description (unit test)"
  - "On this repository's tree the stale-description count is reported, and every sampled flagged item reads as stale intent"
description: "Severity: low. Verdict: should-fix.\n\nFailure scenario: `staleDescription` in packages/rex/src/core/migration-plan-data.ts matches /todo|tbd|not yet|yet to|will be added…/ on any completed, cancelled or deleted item. On this repository's tree it flags 22 items. The ones sampled are adversarial-review findings and incident write-ups that quote the past state (\"Found while fixing…\", \"Severity: medium — Verdict: should-fix…\"). Those descriptions are accurate history, not stale intent, so the reviewer of the plan wades through false positives.\n\nReachable once task 27e4f378 wires buildPlanData into `ndx migrate --plan`. It only affects flags shown for review; nothing is converted on the strength of this flag.\n\nOptions:\n(a) Skip descriptions that carry review or incident markers (Severity:, FAILURE SCENARIO, Found while/by). This is cheap, but heuristic-on-heuristic.\n(b) Flag only when the description opens with future/intent language (opensWithWorkVerb from migration-plan.ts plus TODO/TBD) on a completed item. This is narrower and reuses existing code. Recommended.\n(c) Drop the class and leave stale-description review to capability spec drafting. This loses an acceptance-listed class."
lastModified: "2026-10-08T17:35:31.873Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
